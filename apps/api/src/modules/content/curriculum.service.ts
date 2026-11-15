/**
 * Published curriculum delivery (DM-032).
 *
 * Learner reads resolve exact immutable version IDs only when they belong to the
 * current published release membership graph. Drafts and cross-release content
 * are never returned.
 *
 * Entitlement (until DM-053): all learners are treated as free-tier. Premium
 * units appear in module listings as `locked: true`; GET unit/lesson for a
 * premium unit returns 403 `entitlement_required` and never leaks lesson body.
 *
 * Deterministic and independent of AI/provider config (NFR-004).
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { Database, ReleaseStatus } from "@deutsch-mate/database";
import { sql, type Kysely, type Transaction } from "kysely";

import type { RequestActor } from "../../platform/auth/actor.js";
import {
  buildPageResponse,
  decodeCursor,
  encodeCursor,
  parsePageParams,
} from "../../platform/cursor.js";
import { KYSELY, type KyselyToken } from "../../platform/database.tokens.js";
import { formatImmutableContentEtag } from "../../platform/etag.js";
import { getRequestStore, requireRequestStore } from "../../platform/request-context.js";
import { CurriculumCache } from "./curriculum.cache.js";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CEFR_LEVELS = new Set(["A1", "A2", "B1", "B2"]);

export type AccessTier = "free" | "premium";
/** Until billing entitlements (DM-053), product treats all learners as free. */
export type LearnerEntitlementTier = "free";

export type TranscriptPolicy =
  | "always"
  | "after_first_submission"
  | "after_completion"
  | "never";

export interface CurriculumReleaseDto {
  readonly id: string;
  readonly releaseKey: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly manifestSha256: string;
  readonly status: ReleaseStatus;
  readonly approvedAt: string | null;
  readonly publishedAt: string | null;
  readonly retiredAt: string | null;
  readonly createdAt: string;
}

export interface UnitSummaryDto {
  readonly id: string;
  readonly unitKey: string;
  readonly version: number;
  readonly moduleKey: string;
  readonly level: string;
  readonly title: string;
  readonly summary: string;
  readonly ordinal: number;
  readonly estimatedMinutes: number;
  readonly accessTier: AccessTier;
  readonly locked: boolean;
}

export interface ModuleSummaryDto {
  readonly id: string;
  readonly moduleKey: string;
  readonly version: number;
  readonly level: string;
  readonly title: string;
  readonly description: string;
  readonly ordinal: number;
  readonly units: readonly UnitSummaryDto[];
}

export interface ModulePageDto {
  readonly items: readonly ModuleSummaryDto[];
  readonly page: { readonly nextCursor: string | null };
}

export interface CefrDescriptorDto {
  readonly id: string;
  readonly descriptorKey: string;
  readonly version: number;
  readonly level: string;
  readonly skill: string;
  readonly sourceName: string;
  readonly sourceEdition: string;
  readonly canDo: string;
}

export interface ObjectiveDto {
  readonly id: string;
  readonly objectiveKey: string;
  readonly version: number;
  readonly level: string;
  readonly skill: string;
  readonly title: string;
  readonly description: string;
  readonly cefrDescriptors: readonly CefrDescriptorDto[];
}

export interface LessonSummaryDto {
  readonly id: string;
  readonly lessonKey: string;
  readonly version: number;
  readonly unitKey: string;
  readonly title: string;
  readonly estimatedMinutes: number;
  readonly required: boolean;
  readonly ordinal: number;
}

export interface UnitDto extends UnitSummaryDto {
  readonly objectives: readonly ObjectiveDto[];
  readonly prerequisiteUnitVersionIds: readonly string[];
  readonly lessons: readonly LessonSummaryDto[];
}

export interface ActivityMediaAssetDto {
  readonly purpose: "audio" | "image" | "attachment";
  readonly contentType: string;
  readonly altText: string | null;
  readonly transcriptAvailable: boolean;
  readonly transcriptContent?: Record<string, unknown> | null;
  readonly mediaObjectId: string;
}

export interface ActivityDto {
  readonly id: string;
  readonly activityKey: string;
  readonly version: number;
  readonly type: string;
  readonly level: string;
  readonly prompt: Record<string, unknown>;
  readonly configuration: Record<string, unknown>;
  readonly maxScore: string;
  readonly required: boolean;
  readonly transcriptPolicy: TranscriptPolicy | null;
  readonly assets: readonly ActivityMediaAssetDto[];
  readonly objectives: readonly ObjectiveDto[];
  readonly ordinal: number;
}

export interface LessonDto extends LessonSummaryDto {
  readonly explanation: Record<string, unknown>;
  readonly examples: Record<string, unknown>;
  readonly completionRule: Record<string, unknown>;
  readonly activities: readonly ActivityDto[];
}

interface ReleaseRow {
  id: string;
  release_key: string;
  version: number;
  status: ReleaseStatus;
  title: string;
  description: string;
  manifest_sha256: string;
  approved_at: Date | null;
  published_at: Date | null;
  retired_at: Date | null;
  created_at: Date;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toReleaseDto(row: ReleaseRow): CurriculumReleaseDto {
  return {
    id: row.id,
    releaseKey: row.release_key,
    version: row.version,
    title: row.title,
    description: row.description,
    manifestSha256: row.manifest_sha256,
    status: row.status,
    approvedAt: toIso(row.approved_at),
    publishedAt: toIso(row.published_at),
    retiredAt: toIso(row.retired_at),
    createdAt: toIso(row.created_at)!,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function formatDecimal(value: unknown): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "0";
}

function parseAccessTier(value: string): AccessTier {
  return value === "premium" ? "premium" : "free";
}

/**
 * Entitlement stub until DM-053 billing entitlements. Documented: all learners
 * are free-tier; premium unit/lesson bodies are refused with entitlement_required.
 */
export function resolveLearnerEntitlement(actor: RequestActor): LearnerEntitlementTier {
  void actor;
  return "free";
}

function unitLocked(accessTier: AccessTier, entitlement: LearnerEntitlementTier): boolean {
  return accessTier === "premium" && entitlement === "free";
}

function assertUuidV7(value: string, label: string): void {
  if (!UUID_V7_RE.test(value)) {
    throw new BadRequestException({
      code: "validation_failed",
      detail: `${label} must be a UUIDv7.`,
    });
  }
}

function releaseEtag(dto: CurriculumReleaseDto): string {
  return formatImmutableContentEtag(
    `curriculum_release:${dto.id}:${dto.version}:${dto.manifestSha256}:${dto.status}`,
  );
}

function unitEtag(id: string, version: number): string {
  return formatImmutableContentEtag(`unit_version:${id}:${version}`);
}

function lessonEtag(id: string, version: number): string {
  return formatImmutableContentEtag(`lesson_version:${id}:${version}`);
}

function throwEntitlementRequired(): never {
  throw new ForbiddenException({
    code: "entitlement_required",
    detail:
      "Premium curriculum requires an active premium entitlement. Until billing (DM-053), learners are free-tier only.",
  });
}

@Injectable()
export class CurriculumService {
  constructor(
    @Optional() @Inject(KYSELY) private readonly db: KyselyToken | null,
    private readonly cache: CurriculumCache,
  ) {}

  private requireDb(): Kysely<Database> {
    if (!this.db) {
      throw new Error("CurriculumService requires DATABASE_URL.");
    }
    return this.db;
  }

  private async withApiRole<T>(
    fn: (executor: Kysely<Database> | Transaction<Database>) => Promise<T>,
  ): Promise<T> {
    const store = getRequestStore();
    if (store?.trx) {
      return fn(store.trx);
    }
    const actor = store?.actor;
    if (!actor) {
      throw new Error("CurriculumService read requires an authenticated actor.");
    }
    return this.requireDb()
      .transaction()
      .execute(async (trx) => {
        await sql`SET LOCAL ROLE dm_api`.execute(trx);
        await sql`SELECT set_config('app.user_id', ${actor.userId}, true)`.execute(trx);
        await sql`SELECT set_config('app.roles', ${actor.roles.join(",")}, true)`.execute(trx);
        await sql`SELECT set_config('app.correlation_id', ${store.requestId}, true)`.execute(
          trx,
        );
        return fn(trx);
      });
  }

  async getCurrentPublishedRelease(): Promise<{
    readonly release: CurriculumReleaseDto;
    readonly etag: string;
  } | null> {
    return this.withApiRole(async (executor) => {
      const rows = await sql<ReleaseRow>`
        SELECT
          id, release_key, version, status, title, description, manifest_sha256,
          approved_at, published_at, retired_at, created_at
        FROM content.v_published_curriculum_releases
        ORDER BY published_at DESC NULLS LAST
        LIMIT 1
      `.execute(executor);

      const row = rows.rows[0];
      if (!row) {
        return null;
      }
      const dto = toReleaseDto(row);
      const etag = releaseEtag(dto);
      await this.cache.setJson(this.cache.releaseKey(dto.id), dto);
      return { release: dto, etag };
    });
  }

  /**
   * First free-tier published unit at the given CEFR level (module ordinal, then
   * unit ordinal). Used by onboarding completion — never drafts or premium bodies.
   */
  async findFirstFreeUnitAtLevel(level: string): Promise<UnitSummaryDto | null> {
    if (!CEFR_LEVELS.has(level)) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "level must be one of A1, A2, B1, B2.",
      });
    }

    return this.withApiRole(async (executor) => {
      const rows = await sql<{
        id: string;
        unit_key: string;
        version: number;
        module_key: string;
        level: string;
        title: string;
        summary: string;
        ordinal: number;
        estimated_minutes: number;
        access_tier: string;
      }>`
        SELECT
          uv.id,
          uv.unit_key,
          uv.version,
          uv.module_key,
          uv.level::text AS level,
          uv.title,
          uv.summary,
          mu.ordinal,
          uv.estimated_minutes,
          uv.access_tier
        FROM content.v_published_curriculum_releases AS r
        JOIN content.release_modules AS rm ON rm.release_id = r.id
        JOIN content.v_published_module_versions AS mv ON mv.id = rm.module_version_id
        JOIN content.module_units AS mu ON mu.module_version_id = mv.id
        JOIN content.v_published_unit_versions AS uv ON uv.id = mu.unit_version_id
        WHERE mv.level::text = ${level}
          AND uv.access_tier = 'free'
        ORDER BY rm.ordinal ASC, mu.ordinal ASC
        LIMIT 1
      `.execute(executor);

      const row = rows.rows[0];
      if (!row) {
        return null;
      }
      const accessTier = parseAccessTier(row.access_tier);
      return {
        id: row.id,
        unitKey: row.unit_key,
        version: row.version,
        moduleKey: row.module_key,
        level: row.level,
        title: row.title,
        summary: row.summary,
        ordinal: row.ordinal,
        estimatedMinutes: row.estimated_minutes,
        accessTier,
        locked: false,
      };
    });
  }

  async getUnitSummary(unitVersionId: string): Promise<UnitSummaryDto | null> {
    assertUuidV7(unitVersionId, "unitVersionId");
    return this.withApiRole(async (executor) => {
      const rows = await sql<{
        id: string;
        unit_key: string;
        version: number;
        module_key: string;
        level: string;
        title: string;
        summary: string;
        ordinal: number;
        estimated_minutes: number;
        access_tier: string;
      }>`
        SELECT
          uv.id,
          uv.unit_key,
          uv.version,
          uv.module_key,
          uv.level::text AS level,
          uv.title,
          uv.summary,
          uv.ordinal,
          uv.estimated_minutes,
          uv.access_tier
        FROM content.v_published_unit_versions AS uv
        WHERE uv.id = ${unitVersionId}::uuid
      `.execute(executor);
      const row = rows.rows[0];
      if (!row) {
        return null;
      }
      const accessTier = parseAccessTier(row.access_tier);
      return {
        id: row.id,
        unitKey: row.unit_key,
        version: row.version,
        moduleKey: row.module_key,
        level: row.level,
        title: row.title,
        summary: row.summary,
        ordinal: row.ordinal,
        estimatedMinutes: row.estimated_minutes,
        accessTier,
        locked: unitLocked(accessTier, "free"),
      };
    });
  }

  async listModules(
    releaseId: string,
    query: { readonly level?: string; readonly cursor?: string; readonly limit?: string | number },
    entitlement: LearnerEntitlementTier,
  ): Promise<ModulePageDto> {
    assertUuidV7(releaseId, "releaseId");
    if (query.level !== undefined && query.level !== "" && !CEFR_LEVELS.has(query.level)) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "level must be one of A1, A2, B1, B2.",
      });
    }
    const pageParams = parsePageParams(query);
    let afterOrdinal = 0;
    if (pageParams.cursor !== null) {
      const payload = decodeCursor(pageParams.cursor);
      const ordinal = payload["ordinal"];
      if (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 0) {
        throw new BadRequestException({
          code: "validation_failed",
          detail: "cursor is invalid.",
        });
      }
      afterOrdinal = ordinal;
    }

    return this.withApiRole(async (executor) => {
      const published = await sql<{ id: string }>`
        SELECT id
        FROM content.v_published_curriculum_releases
        WHERE id = ${releaseId}::uuid
      `.execute(executor);
      if (!published.rows[0]) {
        throw new NotFoundException({
          code: "not_found",
          detail: "Published curriculum release was not found.",
        });
      }

      const levelFilter =
        query.level !== undefined && query.level !== "" ? query.level : null;

      const modules = await sql<{
        id: string;
        module_key: string;
        version: number;
        level: string;
        title: string;
        description: string;
        ordinal: number;
      }>`
        SELECT
          mv.id,
          mv.module_key,
          mv.version,
          mv.level::text AS level,
          mv.title,
          mv.description,
          rm.ordinal
        FROM content.release_modules AS rm
        JOIN content.v_published_module_versions AS mv ON mv.id = rm.module_version_id
        WHERE rm.release_id = ${releaseId}::uuid
          AND rm.ordinal > ${afterOrdinal}
          AND (${levelFilter}::text IS NULL OR mv.level::text = ${levelFilter})
        ORDER BY rm.ordinal ASC
        LIMIT ${pageParams.limit + 1}
      `.execute(executor);

      const slice = modules.rows.slice(0, pageParams.limit);
      const hasMore = modules.rows.length > pageParams.limit;
      const items: ModuleSummaryDto[] = [];

      for (const mod of slice) {
        const units = await sql<{
          id: string;
          unit_key: string;
          version: number;
          module_key: string;
          level: string;
          title: string;
          summary: string;
          ordinal: number;
          estimated_minutes: number;
          access_tier: string;
        }>`
          SELECT
            uv.id,
            uv.unit_key,
            uv.version,
            uv.module_key,
            uv.level::text AS level,
            uv.title,
            uv.summary,
            mu.ordinal,
            uv.estimated_minutes,
            uv.access_tier
          FROM content.module_units AS mu
          JOIN content.v_published_unit_versions AS uv ON uv.id = mu.unit_version_id
          WHERE mu.module_version_id = ${mod.id}::uuid
          ORDER BY mu.ordinal ASC
        `.execute(executor);

        items.push({
          id: mod.id,
          moduleKey: mod.module_key,
          version: mod.version,
          level: mod.level,
          title: mod.title,
          description: mod.description,
          ordinal: mod.ordinal,
          units: units.rows.map((u) => {
            const accessTier = parseAccessTier(u.access_tier);
            return {
              id: u.id,
              unitKey: u.unit_key,
              version: u.version,
              moduleKey: u.module_key,
              level: u.level,
              title: u.title,
              summary: u.summary,
              ordinal: u.ordinal,
              estimatedMinutes: u.estimated_minutes,
              accessTier,
              locked: unitLocked(accessTier, entitlement),
            };
          }),
        });
      }

      const last = slice[slice.length - 1];
      const nextCursor =
        hasMore && last ? encodeCursor({ v: 1, ordinal: last.ordinal }) : null;

      return buildPageResponse(items, nextCursor);
    });
  }

  async getUnit(
    unitVersionId: string,
    entitlement: LearnerEntitlementTier,
  ): Promise<{ readonly unit: UnitDto; readonly etag: string }> {
    assertUuidV7(unitVersionId, "unitVersionId");

    return this.withApiRole(async (executor) => {
      const units = await sql<{
        id: string;
        unit_key: string;
        version: number;
        module_key: string;
        level: string;
        title: string;
        summary: string;
        ordinal: number;
        estimated_minutes: number;
        access_tier: string;
      }>`
        SELECT
          uv.id,
          uv.unit_key,
          uv.version,
          uv.module_key,
          uv.level::text AS level,
          uv.title,
          uv.summary,
          uv.ordinal,
          uv.estimated_minutes,
          uv.access_tier
        FROM content.v_published_unit_versions AS uv
        WHERE uv.id = ${unitVersionId}::uuid
      `.execute(executor);

      const row = units.rows[0];
      if (!row) {
        throw new NotFoundException({
          code: "not_found",
          detail: "Published unit was not found.",
        });
      }

      const accessTier = parseAccessTier(row.access_tier);
      if (unitLocked(accessTier, entitlement)) {
        throwEntitlementRequired();
      }

      const objectives = await this.loadObjectivesForUnit(executor, unitVersionId);
      const prereqs = await sql<{ prerequisite_unit_version_id: string }>`
        SELECT prerequisite_unit_version_id
        FROM content.unit_prerequisites
        WHERE unit_version_id = ${unitVersionId}::uuid
        ORDER BY prerequisite_unit_version_id
      `.execute(executor);

      const lessons = await sql<{
        id: string;
        lesson_key: string;
        version: number;
        unit_key: string;
        title: string;
        estimated_minutes: number;
        required: boolean;
        ordinal: number;
      }>`
        SELECT
          lv.id,
          lv.lesson_key,
          lv.version,
          lv.unit_key,
          lv.title,
          lv.estimated_minutes,
          ul.required,
          ul.ordinal
        FROM content.unit_lessons AS ul
        JOIN content.v_published_lesson_versions AS lv ON lv.id = ul.lesson_version_id
        WHERE ul.unit_version_id = ${unitVersionId}::uuid
        ORDER BY ul.ordinal ASC
      `.execute(executor);

      const unit: UnitDto = {
        id: row.id,
        unitKey: row.unit_key,
        version: row.version,
        moduleKey: row.module_key,
        level: row.level,
        title: row.title,
        summary: row.summary,
        ordinal: row.ordinal,
        estimatedMinutes: row.estimated_minutes,
        accessTier,
        locked: false,
        objectives,
        prerequisiteUnitVersionIds: prereqs.rows.map((p) => p.prerequisite_unit_version_id),
        lessons: lessons.rows.map((l) => ({
          id: l.id,
          lessonKey: l.lesson_key,
          version: l.version,
          unitKey: l.unit_key,
          title: l.title,
          estimatedMinutes: l.estimated_minutes,
          required: l.required,
          ordinal: l.ordinal,
        })),
      };

      return { unit, etag: unitEtag(unit.id, unit.version) };
    });
  }

  async getLesson(
    lessonVersionId: string,
    entitlement: LearnerEntitlementTier,
  ): Promise<{ readonly lesson: LessonDto; readonly etag: string }> {
    assertUuidV7(lessonVersionId, "lessonVersionId");

    return this.withApiRole(async (executor) => {
      const lessons = await sql<{
        id: string;
        lesson_key: string;
        version: number;
        unit_key: string;
        title: string;
        explanation: unknown;
        examples: unknown;
        completion_rule: unknown;
        estimated_minutes: number;
        required: boolean;
        ordinal: number;
        unit_version_id: string;
        access_tier: string;
      }>`
        SELECT
          lv.id,
          lv.lesson_key,
          lv.version,
          lv.unit_key,
          lv.title,
          lv.explanation,
          lv.examples,
          lv.completion_rule,
          lv.estimated_minutes,
          ul.required,
          ul.ordinal,
          ul.unit_version_id,
          uv.access_tier
        FROM content.v_published_lesson_versions AS lv
        JOIN content.unit_lessons AS ul ON ul.lesson_version_id = lv.id
        JOIN content.v_published_unit_versions AS uv ON uv.id = ul.unit_version_id
        WHERE lv.id = ${lessonVersionId}::uuid
        LIMIT 1
      `.execute(executor);

      const row = lessons.rows[0];
      if (!row) {
        throw new NotFoundException({
          code: "not_found",
          detail: "Published lesson was not found.",
        });
      }

      const accessTier = parseAccessTier(row.access_tier);
      if (unitLocked(accessTier, entitlement)) {
        throwEntitlementRequired();
      }

      const activities = await this.loadActivities(executor, lessonVersionId);

      const lesson: LessonDto = {
        id: row.id,
        lessonKey: row.lesson_key,
        version: row.version,
        unitKey: row.unit_key,
        title: row.title,
        estimatedMinutes: row.estimated_minutes,
        required: row.required,
        ordinal: row.ordinal,
        explanation: asRecord(row.explanation),
        examples: asRecord(row.examples),
        completionRule: asRecord(row.completion_rule),
        activities,
      };

      return { lesson, etag: lessonEtag(lesson.id, lesson.version) };
    });
  }

  private async loadObjectivesForUnit(
    executor: Kysely<Database> | Transaction<Database>,
    unitVersionId: string,
  ): Promise<ObjectiveDto[]> {
    const objectives = await sql<{
      id: string;
      objective_key: string;
      version: number;
      level: string;
      skill: string;
      title: string;
      description: string;
    }>`
      SELECT
        ov.id,
        ov.objective_key,
        ov.version,
        ov.level::text AS level,
        ov.skill::text AS skill,
        ov.title,
        ov.description
      FROM content.unit_objectives AS uo
      JOIN content.objective_versions AS ov ON ov.id = uo.objective_version_id
      WHERE uo.unit_version_id = ${unitVersionId}::uuid
      ORDER BY uo.is_primary DESC, ov.objective_key ASC
    `.execute(executor);

    return this.attachDescriptors(executor, objectives.rows);
  }

  private async loadObjectivesForActivity(
    executor: Kysely<Database> | Transaction<Database>,
    activityVersionId: string,
  ): Promise<ObjectiveDto[]> {
    const objectives = await sql<{
      id: string;
      objective_key: string;
      version: number;
      level: string;
      skill: string;
      title: string;
      description: string;
    }>`
      SELECT
        ov.id,
        ov.objective_key,
        ov.version,
        ov.level::text AS level,
        ov.skill::text AS skill,
        ov.title,
        ov.description
      FROM content.activity_objectives AS ao
      JOIN content.objective_versions AS ov ON ov.id = ao.objective_version_id
      WHERE ao.activity_version_id = ${activityVersionId}::uuid
      ORDER BY ao.weight DESC, ov.objective_key ASC
    `.execute(executor);

    return this.attachDescriptors(executor, objectives.rows);
  }

  private async attachDescriptors(
    executor: Kysely<Database> | Transaction<Database>,
    objectives: readonly {
      id: string;
      objective_key: string;
      version: number;
      level: string;
      skill: string;
      title: string;
      description: string;
    }[],
  ): Promise<ObjectiveDto[]> {
    const result: ObjectiveDto[] = [];
    for (const obj of objectives) {
      const descriptors = await sql<{
        id: string;
        descriptor_key: string;
        version: number;
        level: string;
        skill: string;
        source_name: string;
        source_edition: string;
        descriptor_text: string;
      }>`
        SELECT
          cd.id,
          cd.descriptor_key,
          cd.version,
          cd.level::text AS level,
          cd.skill::text AS skill,
          cd.source_name,
          cd.source_edition,
          cd.descriptor_text
        FROM content.objective_descriptors AS od
        JOIN content.cefr_descriptor_versions AS cd ON cd.id = od.descriptor_version_id
        WHERE od.objective_version_id = ${obj.id}::uuid
        ORDER BY cd.descriptor_key ASC
      `.execute(executor);

      result.push({
        id: obj.id,
        objectiveKey: obj.objective_key,
        version: obj.version,
        level: obj.level,
        skill: obj.skill,
        title: obj.title,
        description: obj.description,
        cefrDescriptors: descriptors.rows.map((d) => ({
          id: d.id,
          descriptorKey: d.descriptor_key,
          version: d.version,
          level: d.level,
          skill: d.skill,
          sourceName: d.source_name,
          sourceEdition: d.source_edition,
          canDo: d.descriptor_text,
        })),
      });
    }
    return result;
  }

  private async loadActivities(
    executor: Kysely<Database> | Transaction<Database>,
    lessonVersionId: string,
  ): Promise<ActivityDto[]> {
    const activities = await sql<{
      id: string;
      activity_key: string;
      version: number;
      type: string;
      level: string;
      prompt: unknown;
      configuration: unknown;
      max_score: unknown;
      required: boolean;
      transcript_policy: TranscriptPolicy | null;
      ordinal: number;
    }>`
      SELECT
        av.id,
        av.activity_key,
        av.version,
        av.type::text AS type,
        av.level::text AS level,
        av.prompt,
        av.configuration,
        av.max_score,
        av.required,
        av.transcript_policy,
        la.ordinal
      FROM content.lesson_activities AS la
      JOIN content.v_published_activity_versions AS av ON av.id = la.activity_version_id
      WHERE la.lesson_version_id = ${lessonVersionId}::uuid
      ORDER BY la.ordinal ASC
    `.execute(executor);

    const result: ActivityDto[] = [];
    for (const act of activities.rows) {
      const objectives = await this.loadObjectivesForActivity(executor, act.id);
      const assets = await this.loadAssets(executor, act.id, act.transcript_policy);
      result.push({
        id: act.id,
        activityKey: act.activity_key,
        version: act.version,
        type: act.type,
        level: act.level,
        prompt: asRecord(act.prompt),
        configuration: asRecord(act.configuration),
        maxScore: formatDecimal(act.max_score),
        required: act.required,
        transcriptPolicy: act.transcript_policy,
        assets,
        objectives,
        ordinal: act.ordinal,
      });
    }
    return result;
  }

  /**
   * Client-safe listening/media metadata: opaque mediaObjectId + contentType.
   * Never exposes bucket/object keys or signed URLs (signed downloads deferred).
   * Transcript content is included only when transcriptPolicy = always.
   */
  private async loadAssets(
    executor: Kysely<Database> | Transaction<Database>,
    activityVersionId: string,
    transcriptPolicy: TranscriptPolicy | null,
  ): Promise<ActivityMediaAssetDto[]> {
    const assets = await sql<{
      media_object_id: string;
      purpose: string;
      alt_text: string | null;
      transcript: unknown;
      content_type: string;
    }>`
      SELECT
        aa.media_object_id,
        aa.purpose,
        aa.alt_text,
        aa.transcript,
        mo.content_type
      FROM content.activity_assets AS aa
      JOIN media.objects AS mo ON mo.id = aa.media_object_id
      WHERE aa.activity_version_id = ${activityVersionId}::uuid
        AND mo.state = 'available'::media.object_state
      ORDER BY aa.ordinal ASC
    `.execute(executor);

    const permitTranscript = transcriptPolicy === "always";

    return assets.rows.map((a) => {
      const base: ActivityMediaAssetDto = {
        purpose: a.purpose as ActivityMediaAssetDto["purpose"],
        contentType: a.content_type,
        altText: a.alt_text,
        transcriptAvailable: permitTranscript && a.transcript !== null,
        mediaObjectId: a.media_object_id,
      };
      if (permitTranscript && a.transcript !== null) {
        return {
          ...base,
          transcriptContent: asRecord(a.transcript),
        };
      }
      return {
        ...base,
        transcriptContent: null,
      };
    });
  }
}

/** Convenience for controllers: require authenticated actor + free entitlement stub. */
export function requireCurriculumActor(): {
  readonly actor: RequestActor;
  readonly entitlement: LearnerEntitlementTier;
} {
  const actor = requireRequestStore().actor;
  if (!actor) {
    throw new Error("expected authenticated actor");
  }
  return { actor, entitlement: resolveLearnerEntitlement(actor) };
}
