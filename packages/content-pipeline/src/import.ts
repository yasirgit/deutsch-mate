import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { createUuidV7 } from "@deutsch-mate/domain";
import pg from "pg";

import type { LoadedRelease } from "./inventory.js";
import { validateReleaseInventory } from "./inventory.js";
import type { ContentManifest } from "./manifest.js";
import { buildManifest } from "./manifest.js";
import {
  asActivityView,
  type ActivityView,
  type AnswerKeyView,
  type RubricView,
} from "./activity-view.js";

/**
 * Content import uses the deployment/owner Postgres connection (`DATABASE_URL`).
 * Local Compose `deutsch_mate` is a superuser and bypasses FORCE RLS. Production
 * should use an audited owner/service session. Status remains `draft` (DM-031).
 */

const CONTENT_BUCKET_ALIAS = "content-assets";
const CONTENT_KMS_ALIAS = "alias/dm-content-local";

export interface ImportOptions {
  readonly connectionString: string;
  readonly loaded: LoadedRelease;
  readonly importerEmail?: string;
}

export interface ImportResult {
  readonly releaseId: string;
  readonly releaseKey: string;
  readonly releaseVersion: number;
  readonly status: "draft";
  readonly manifestSha256: string;
  readonly inserted: {
    readonly descriptors: number;
    readonly objectives: number;
    readonly modules: number;
    readonly units: number;
    readonly lessons: number;
    readonly activities: number;
    readonly answerKeys: number;
    readonly rubrics: number;
    readonly mediaObjects: number;
  };
  readonly skippedExisting: number;
}

function versionKey(key: string, version: number): string {
  return `${key}@${version}`;
}

async function ensureImporterUser(client: pg.PoolClient, email: string): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM iam.users WHERE primary_email = $1`,
    [email],
  );
  if (existing.rows[0] !== undefined) {
    return existing.rows[0].id;
  }
  const id = createUuidV7();
  const pseudonym = createUuidV7();
  await client.query(
    `INSERT INTO iam.users (id, primary_email, pseudonym_key, status)
     VALUES ($1::uuid, $2, $3::uuid, 'active')`,
    [id, email, pseudonym],
  );
  await client.query(
    `INSERT INTO iam.user_roles (id, user_id, role, reason)
     VALUES ($1::uuid, $2::uuid, 'content_editor', 'content import bootstrap')`,
    [createUuidV7(), id],
  );
  return id;
}

async function upsertByKeyVersion(
  client: pg.PoolClient,
  selectSql: string,
  selectParams: unknown[],
  insert: () => Promise<string>,
): Promise<{ id: string; inserted: boolean }> {
  const found = await client.query<{ id: string }>(selectSql, selectParams);
  if (found.rows[0] !== undefined) {
    return { id: found.rows[0].id, inserted: false };
  }
  const id = await insert();
  return { id, inserted: true };
}

/**
 * Idempotent draft import of a validated release package into PostgreSQL.
 */
export async function importRelease(options: ImportOptions): Promise<ImportResult> {
  const inventory = validateReleaseInventory(options.loaded);
  if (!inventory.ok) {
    const detail = inventory.issues.map((i) => `${i.code}: ${i.message}`).join("; ");
    throw new Error(`Refusing import: inventory failed — ${detail}`);
  }

  const manifest: ContentManifest = buildManifest(options.loaded);
  const counts = {
    descriptors: 0,
    objectives: 0,
    modules: 0,
    units: 0,
    lessons: 0,
    activities: 0,
    answerKeys: 0,
    rubrics: 0,
    mediaObjects: 0,
  };
  let skippedExisting = 0;

  const pool = new pg.Pool({ connectionString: options.connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const importerId = await ensureImporterUser(
      client,
      options.importerEmail ?? "content-importer@deutsch-mate.local",
    );

    const descriptorIds = new Map<string, string>();
    for (const doc of options.loaded.descriptors) {
      const key = versionKey(doc.descriptorKey, doc.version);
      const result = await upsertByKeyVersion(
        client,
        `SELECT id::text AS id FROM content.cefr_descriptor_versions
         WHERE descriptor_key = $1 AND version = $2`,
        [doc.descriptorKey, doc.version],
        async () => {
          const id = createUuidV7();
          await client.query(
            `INSERT INTO content.cefr_descriptor_versions (
               id, descriptor_key, version, level, skill, source_name, source_edition, descriptor_text
             ) VALUES ($1::uuid, $2, $3, $4::learner.cefr_level, $5::content.skill_code, $6, $7, $8)`,
            [
              id,
              doc.descriptorKey,
              doc.version,
              doc.level,
              doc.skill,
              doc.sourceName,
              doc.sourceEdition,
              doc.descriptorText,
            ],
          );
          counts.descriptors += 1;
          return id;
        },
      );
      if (!result.inserted) {
        skippedExisting += 1;
      }
      descriptorIds.set(key, result.id);
    }

    const objectiveIds = new Map<string, string>();
    for (const doc of options.loaded.objectives) {
      const key = versionKey(doc.objectiveKey, doc.version);
      const result = await upsertByKeyVersion(
        client,
        `SELECT id::text AS id FROM content.objective_versions
         WHERE objective_key = $1 AND version = $2`,
        [doc.objectiveKey, doc.version],
        async () => {
          const id = createUuidV7();
          await client.query(
            `INSERT INTO content.objective_versions (
               id, objective_key, version, level, skill, title, description, created_by
             ) VALUES ($1::uuid, $2, $3, $4::learner.cefr_level, $5::content.skill_code, $6, $7, $8::uuid)`,
            [
              id,
              doc.objectiveKey,
              doc.version,
              doc.level,
              doc.skill,
              doc.title,
              doc.description,
              importerId,
            ],
          );
          for (const link of doc.descriptors) {
            const descriptorId = descriptorIds.get(
              versionKey(link.descriptorKey, link.descriptorVersion),
            );
            if (descriptorId === undefined) {
              throw new Error(`Missing descriptor ${link.descriptorKey}@${link.descriptorVersion}`);
            }
            await client.query(
              `INSERT INTO content.objective_descriptors (objective_version_id, descriptor_version_id)
               VALUES ($1::uuid, $2::uuid)
               ON CONFLICT DO NOTHING`,
              [id, descriptorId],
            );
          }
          counts.objectives += 1;
          return id;
        },
      );
      if (!result.inserted) {
        skippedExisting += 1;
      }
      objectiveIds.set(key, result.id);
    }

    const mediaByAssetKey = new Map<string, string>();

    const insertAnswerKey = async (
      activityId: string,
      answerKey: AnswerKeyView,
    ): Promise<void> => {
      const existing = await client.query(
        `SELECT 1 FROM content.answer_key_versions
         WHERE activity_version_id = $1::uuid AND version = $2`,
        [activityId, answerKey.version],
      );
      if ((existing.rowCount ?? 0) > 0) {
        skippedExisting += 1;
        return;
      }
      await client.query(
        `INSERT INTO content.answer_key_versions (
           id, activity_version_id, version, scoring_algorithm_version,
           answer_spec, rationale, max_score, created_by
         ) VALUES (
           $1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::jsonb, $7::numeric, $8::uuid
         )`,
        [
          createUuidV7(),
          activityId,
          answerKey.version,
          answerKey.scoringAlgorithmVersion,
          JSON.stringify(answerKey.answerSpec),
          JSON.stringify(answerKey.rationale ?? { type: "doc", version: 1, blocks: [] }),
          answerKey.maxScore,
          importerId,
        ],
      );
      counts.answerKeys += 1;
    };

    const insertRubric = async (activityId: string, rubric: RubricView): Promise<void> => {
      const existing = await client.query(
        `SELECT 1 FROM content.rubric_versions WHERE rubric_key = $1 AND version = $2`,
        [rubric.rubricKey, rubric.version],
      );
      if ((existing.rowCount ?? 0) > 0) {
        skippedExisting += 1;
        return;
      }
      await client.query(
        `INSERT INTO content.rubric_versions (
           id, rubric_key, version, activity_version_id, dimensions, scoring_rule, created_by
         ) VALUES (
           $1::uuid, $2, $3, $4::uuid, $5::jsonb, $6::jsonb, $7::uuid
         )`,
        [
          createUuidV7(),
          rubric.rubricKey,
          rubric.version,
          activityId,
          JSON.stringify(rubric.dimensions),
          JSON.stringify(rubric.scoringRule),
          importerId,
        ],
      );
      counts.rubrics += 1;
    };

    const ensureMedia = async (
      assetKey: string,
      sourcePath: string,
      contentType: string,
      sha256: string,
    ): Promise<string> => {
      const cached = mediaByAssetKey.get(assetKey);
      if (cached !== undefined) {
        return cached;
      }
      const objectKey = `curriculum/${assetKey.replace(/\./g, "/")}`;
      const existing = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM media.objects
         WHERE bucket_alias = $1 AND object_key = $2`,
        [CONTENT_BUCKET_ALIAS, objectKey],
      );
      if (existing.rows[0] !== undefined) {
        mediaByAssetKey.set(assetKey, existing.rows[0].id);
        skippedExisting += 1;
        return existing.rows[0].id;
      }
      const abs = path.resolve(options.loaded.releaseDir, sourcePath);
      const sizeBytes = statSync(abs).size;
      const digest = createHash("sha256").update(readFileSync(abs)).digest("hex");
      if (digest !== sha256) {
        throw new Error(`Asset checksum drift at import for ${assetKey}`);
      }
      const id = createUuidV7();
      await client.query(
        `INSERT INTO media.objects (
           id, owner_user_id, data_class, bucket_alias, object_key, state,
           content_type, size_bytes, sha256, kms_key_alias, available_at
         ) VALUES (
           $1::uuid, NULL, 'lesson_audio'::media.data_class, $2, $3,
           'available'::media.object_state, $4, $5, $6, $7, now()
         )`,
        [id, CONTENT_BUCKET_ALIAS, objectKey, contentType, sizeBytes, sha256, CONTENT_KMS_ALIAS],
      );
      mediaByAssetKey.set(assetKey, id);
      counts.mediaObjects += 1;
      return id;
    };

    const insertActivity = async (
      lessonId: string,
      ordinal: number,
      activity: ActivityView,
    ): Promise<string> => {
      const result = await upsertByKeyVersion(
        client,
        `SELECT id::text AS id FROM content.activity_versions
         WHERE activity_key = $1 AND version = $2`,
        [activity.activityKey, activity.version],
        async () => {
          const id = createUuidV7();
          await client.query(
            `INSERT INTO content.activity_versions (
               id, activity_key, version, type, level, prompt, configuration,
               max_score, required, transcript_policy, created_by
             ) VALUES (
               $1::uuid, $2, $3, $4::content.activity_type, $5::learner.cefr_level,
               $6::jsonb, $7::jsonb, $8::numeric, $9,
               $10::content.transcript_policy, $11::uuid
             )`,
            [
              id,
              activity.activityKey,
              activity.version,
              activity.type,
              activity.level,
              JSON.stringify(activity.prompt),
              JSON.stringify(activity.configuration),
              activity.maxScore,
              activity.required,
              activity.transcriptPolicy,
              importerId,
            ],
          );
          for (const link of activity.objectives) {
            const objectiveId = objectiveIds.get(
              versionKey(link.objectiveKey, link.objectiveVersion),
            );
            if (objectiveId === undefined) {
              throw new Error(`Missing objective ${link.objectiveKey}@${link.objectiveVersion}`);
            }
            await client.query(
              `INSERT INTO content.activity_objectives (activity_version_id, objective_version_id, weight)
               VALUES ($1::uuid, $2::uuid, $3::numeric)
               ON CONFLICT DO NOTHING`,
              [id, objectiveId, link.weight],
            );
          }
          for (const asset of activity.assets) {
            const mediaId = await ensureMedia(
              asset.assetKey,
              asset.sourcePath,
              asset.contentType,
              asset.sha256,
            );
            await client.query(
              `INSERT INTO content.activity_assets (
                 activity_version_id, media_object_id, purpose, ordinal, alt_text, transcript
               ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
               ON CONFLICT DO NOTHING`,
              [
                id,
                mediaId,
                asset.purpose,
                asset.ordinal,
                asset.altText ?? null,
                asset.transcript === undefined ? null : JSON.stringify(asset.transcript),
              ],
            );
          }
          if (
            activity.type === "selection" ||
            activity.type === "matching" ||
            activity.type === "ordering" ||
            activity.type === "cloze" ||
            activity.type === "typed_response"
          ) {
            if (activity.answerKey === undefined) {
              throw new Error(`Missing answer key for ${activity.activityKey}`);
            }
            await insertAnswerKey(id, activity.answerKey);
          }
          if (activity.type === "writing") {
            if (activity.rubric === undefined) {
              throw new Error(`Missing rubric for ${activity.activityKey}`);
            }
            await insertRubric(id, activity.rubric);
          }
          counts.activities += 1;
          return id;
        },
      );
      if (!result.inserted) {
        skippedExisting += 1;
      }
      await client.query(
        `INSERT INTO content.lesson_activities (lesson_version_id, activity_version_id, ordinal)
         VALUES ($1::uuid, $2::uuid, $3)
         ON CONFLICT DO NOTHING`,
        [lessonId, result.id, ordinal],
      );
      return result.id;
    };

    const unitIds = new Map<string, string>();
    for (const unit of options.loaded.units) {
      const key = versionKey(unit.unitKey, unit.version);
      const result = await upsertByKeyVersion(
        client,
        `SELECT id::text AS id FROM content.unit_versions WHERE unit_key = $1 AND version = $2`,
        [unit.unitKey, unit.version],
        async () => {
          const id = createUuidV7();
          await client.query(
            `INSERT INTO content.unit_versions (
               id, unit_key, version, module_key, level, title, summary, ordinal,
               estimated_minutes, access_tier, created_by
             ) VALUES (
               $1::uuid, $2, $3, $4, $5::learner.cefr_level, $6, $7, $8, $9, $10, $11::uuid
             )`,
            [
              id,
              unit.unitKey,
              unit.version,
              unit.moduleKey,
              unit.level,
              unit.title,
              unit.summary,
              unit.ordinal,
              unit.estimatedMinutes,
              unit.accessTier,
              importerId,
            ],
          );
          for (const link of unit.objectives) {
            const objectiveId = objectiveIds.get(
              versionKey(link.objectiveKey, link.objectiveVersion),
            );
            if (objectiveId === undefined) {
              throw new Error(`Missing objective ${link.objectiveKey}@${link.objectiveVersion}`);
            }
            await client.query(
              `INSERT INTO content.unit_objectives (unit_version_id, objective_version_id, is_primary)
               VALUES ($1::uuid, $2::uuid, $3)
               ON CONFLICT DO NOTHING`,
              [id, objectiveId, link.isPrimary],
            );
          }
          for (const lessonLink of unit.lessons) {
            const lesson = lessonLink.lesson;
            const lessonResult = await upsertByKeyVersion(
              client,
              `SELECT id::text AS id FROM content.lesson_versions
               WHERE lesson_key = $1 AND version = $2`,
              [lesson.lessonKey, lesson.version],
              async () => {
                const lessonId = createUuidV7();
                await client.query(
                  `INSERT INTO content.lesson_versions (
                     id, lesson_key, version, unit_key, title, explanation, examples,
                     completion_rule, estimated_minutes, created_by
                   ) VALUES (
                     $1::uuid, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10::uuid
                   )`,
                  [
                    lessonId,
                    lesson.lessonKey,
                    lesson.version,
                    unit.unitKey,
                    lesson.title,
                    JSON.stringify(lesson.explanation),
                    JSON.stringify(lesson.examples),
                    JSON.stringify(lesson.completionRule),
                    lesson.estimatedMinutes,
                    importerId,
                  ],
                );
                for (const activityLink of lesson.activities) {
                  await insertActivity(
                    lessonId,
                    activityLink.ordinal,
                    asActivityView(activityLink.activity),
                  );
                }
                counts.lessons += 1;
                return lessonId;
              },
            );
            if (!lessonResult.inserted) {
              skippedExisting += 1;
            }
            await client.query(
              `INSERT INTO content.unit_lessons (
                 unit_version_id, lesson_version_id, ordinal, required
               ) VALUES ($1::uuid, $2::uuid, $3, $4)
               ON CONFLICT DO NOTHING`,
              [id, lessonResult.id, lessonLink.ordinal, lessonLink.required],
            );
          }
          counts.units += 1;
          return id;
        },
      );
      if (!result.inserted) {
        skippedExisting += 1;
      }
      unitIds.set(key, result.id);
    }

    for (const unit of options.loaded.units) {
      const unitId = unitIds.get(versionKey(unit.unitKey, unit.version));
      if (unitId === undefined) {
        continue;
      }
      for (const prereq of unit.prerequisites) {
        const prereqId = unitIds.get(versionKey(prereq.unitKey, prereq.unitVersion));
        if (prereqId === undefined) {
          throw new Error(`Missing prerequisite unit ${prereq.unitKey}@${prereq.unitVersion}`);
        }
        await client.query(
          `INSERT INTO content.unit_prerequisites (unit_version_id, prerequisite_unit_version_id)
           VALUES ($1::uuid, $2::uuid)
           ON CONFLICT DO NOTHING`,
          [unitId, prereqId],
        );
      }
    }

    const moduleIds = new Map<string, string>();
    for (const mod of options.loaded.modules) {
      const key = versionKey(mod.moduleKey, mod.version);
      const result = await upsertByKeyVersion(
        client,
        `SELECT id::text AS id FROM content.module_versions
         WHERE module_key = $1 AND version = $2`,
        [mod.moduleKey, mod.version],
        async () => {
          const id = createUuidV7();
          await client.query(
            `INSERT INTO content.module_versions (
               id, module_key, version, level, title, description, ordinal, created_by
             ) VALUES (
               $1::uuid, $2, $3, $4::learner.cefr_level, $5, $6, $7, $8::uuid
             )`,
            [
              id,
              mod.moduleKey,
              mod.version,
              mod.level,
              mod.title,
              mod.description,
              mod.ordinal,
              importerId,
            ],
          );
          for (const unitPin of mod.units) {
            const unitId = unitIds.get(versionKey(unitPin.unitKey, unitPin.unitVersion));
            if (unitId === undefined) {
              throw new Error(`Missing unit ${unitPin.unitKey}@${unitPin.unitVersion}`);
            }
            await client.query(
              `INSERT INTO content.module_units (module_version_id, unit_version_id, ordinal)
               VALUES ($1::uuid, $2::uuid, $3)
               ON CONFLICT DO NOTHING`,
              [id, unitId, unitPin.ordinal],
            );
          }
          counts.modules += 1;
          return id;
        },
      );
      if (!result.inserted) {
        skippedExisting += 1;
      }
      moduleIds.set(key, result.id);
    }

    const releaseResult = await upsertByKeyVersion(
      client,
      `SELECT id::text AS id FROM content.curriculum_releases
       WHERE release_key = $1 AND version = $2`,
      [options.loaded.release.releaseKey, options.loaded.release.version],
      async () => {
        const id = createUuidV7();
        await client.query(
          `INSERT INTO content.curriculum_releases (
             id, release_key, version, status, title, description, manifest_sha256, created_by
           ) VALUES (
             $1::uuid, $2, $3, 'draft'::content.release_status, $4, $5, $6, $7::uuid
           )`,
          [
            id,
            options.loaded.release.releaseKey,
            options.loaded.release.version,
            options.loaded.release.title,
            options.loaded.release.description,
            manifest.manifestSha256,
            importerId,
          ],
        );
        return id;
      },
    );
    if (!releaseResult.inserted) {
      skippedExisting += 1;
    }
    const releaseId = releaseResult.id;

    for (const pin of options.loaded.release.modules) {
      const moduleId = moduleIds.get(versionKey(pin.moduleKey, pin.moduleVersion));
      if (moduleId === undefined) {
        throw new Error(`Missing module ${pin.moduleKey}@${pin.moduleVersion}`);
      }
      await client.query(
        `INSERT INTO content.release_modules (release_id, module_version_id, ordinal)
         VALUES ($1::uuid, $2::uuid, $3)
         ON CONFLICT DO NOTHING`,
        [releaseId, moduleId, pin.ordinal],
      );
    }

    await client.query("COMMIT");
    return {
      releaseId,
      releaseKey: options.loaded.release.releaseKey,
      releaseVersion: options.loaded.release.version,
      status: "draft",
      manifestSha256: manifest.manifestSha256,
      inserted: counts,
      skippedExisting,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
