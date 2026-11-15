/**
 * Review scheduling integration (DM-039): valid evidence → review_items,
 * invalid/unverified ignored, API list, rebuild matches live projection.
 */

import "reflect-metadata";

import path from "node:path";

import { importRelease, validateRelease } from "@deutsch-mate/content-pipeline";
import { applyMigrations, createKysely, createPgPool, type Database } from "@deutsch-mate/database";
import { createUuidV7 } from "@deutsch-mate/domain";
import {
  MAX_ACTIVE_REVIEW_ITEMS,
  REVIEW_ALGORITHM_VERSION,
} from "@deutsch-mate/review-algorithm";
import type { INestApplication } from "@nestjs/common";
import { sql, type Kysely } from "kysely";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  TEST_ACTOR_HEADER,
  TEST_ROLES_HEADER,
} from "../../platform/auth/auth.guard.js";
import { StubTokenVerifier } from "../identity/testing/oidc-test-keys.js";
import { ReviewService } from "./review.service.js";
import { createLearningApp } from "./testing/create-learning-app.test.js";

const repoMigrations = path.resolve(process.cwd(), "../../migrations");
const smokeDir = path.resolve(process.cwd(), "../../content/fixtures/import-smoke");

function adminConnectionConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const adminUrl =
    process.env["DATABASE_URL"] ??
    "postgresql://deutsch_mate:local-dev-only-not-a-secret@localhost:54329/deutsch_mate_dev";
  const parsed = new URL(adminUrl);
  return {
    host: parsed.hostname,
    port: parsed.port === "" ? 5432 : Number(parsed.port),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: "postgres",
  };
}

async function createMigratedTestDatabase(dbName: string): Promise<{
  connectionString: string;
  db: Kysely<Database>;
  dispose: () => Promise<void>;
}> {
  const adminConfig = adminConnectionConfig();
  const admin = new pg.Client(adminConfig);
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  const migrator = new pg.Client({ ...adminConfig, database: dbName });
  await migrator.connect();
  try {
    await applyMigrations({
      client: migrator,
      migrationsDir: repoMigrations,
      localRolePassword: adminConfig.password,
    });
  } finally {
    await migrator.end();
  }

  const pool = createPgPool({ ...adminConfig, database: dbName, max: 4 });
  const db = createKysely({ pool });
  const connectionString = `postgresql://${encodeURIComponent(adminConfig.user)}:${encodeURIComponent(adminConfig.password)}@${adminConfig.host}:${adminConfig.port}/${dbName}`;
  return {
    connectionString,
    db,
    dispose: async () => {
      await db.destroy();
      const dropper = new pg.Client(adminConfig);
      await dropper.connect();
      try {
        await dropper.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      } finally {
        await dropper.end();
      }
    },
  };
}

async function seedUser(
  db: Kysely<Database>,
  roles: readonly ("content_editor" | "content_reviewer" | "learner")[],
): Promise<string> {
  const id = createUuidV7();
  await sql`
    INSERT INTO iam.users (id, primary_email, pseudonym_key, status, interface_locale)
    VALUES (
      ${id}::uuid,
      ${`${id}@review.test`},
      ${createUuidV7()}::uuid,
      'active',
      'en'
    )
  `.execute(db);
  for (const role of roles) {
    await sql`
      INSERT INTO iam.user_roles (id, user_id, role, reason)
      VALUES (${createUuidV7()}::uuid, ${id}::uuid, ${role}::iam.role_code, 'dm-039 test')
    `.execute(db);
  }
  return id;
}

describe("review scheduling (DM-039)", () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let disposeDb: () => Promise<void>;
  let learnerId: string;
  let otherLearnerId: string;
  let editorId: string;
  let releaseId: string;
  let freeUnitId: string;
  let lessonId: string;
  let selectionActivityId: string;
  let writingActivityId: string;
  let objectiveId: string;

  beforeAll(async () => {
    const dbName = `dm_review_${Date.now()}`;
    const created = await createMigratedTestDatabase(dbName);
    db = created.db;
    disposeDb = created.dispose;
    const connectionString = created.connectionString;
    process.env["DATABASE_URL"] = connectionString;

    editorId = await seedUser(db, ["content_editor"]);
    const submitterId = await seedUser(db, ["content_reviewer"]);
    const reviewerId = await seedUser(db, ["content_reviewer"]);
    learnerId = await seedUser(db, ["learner"]);
    otherLearnerId = await seedUser(db, ["learner"]);

    const validated = validateRelease({ dir: smokeDir, writeManifestFile: false });
    expect(validated.inventory.ok).toBe(true);
    const imported = await importRelease({
      connectionString,
      loaded: validated.loaded,
      importerEmail: `${editorId}@importer.test`,
    });
    await sql`
      UPDATE content.curriculum_releases
      SET created_by = ${editorId}::uuid
      WHERE id = ${imported.releaseId}::uuid
    `.execute(db);
    releaseId = imported.releaseId;

    const freeUnitPre = await sql<{ id: string }>`
      SELECT id FROM content.unit_versions WHERE unit_key = 'unit.a1.smoke.u1' LIMIT 1
    `.execute(db);
    freeUnitId = freeUnitPre.rows[0]!.id;

    const lessonPre = await sql<{ id: string }>`
      SELECT lv.id
      FROM content.unit_lessons AS ul
      JOIN content.lesson_versions AS lv ON lv.id = ul.lesson_version_id
      WHERE ul.unit_version_id = ${freeUnitId}::uuid
      ORDER BY ul.ordinal
      LIMIT 1
    `.execute(db);
    lessonId = lessonPre.rows[0]!.id;

    const selectionPre = await sql<{ id: string }>`
      SELECT id FROM content.activity_versions
      WHERE activity_key = 'act.a1.smoke.u1.sel01' LIMIT 1
    `.execute(db);
    selectionActivityId = selectionPre.rows[0]!.id;

    const writingPre = await sql<{ id: string }>`
      SELECT id FROM content.activity_versions
      WHERE activity_key = 'act.a1.smoke.u1.writing' LIMIT 1
    `.execute(db);
    writingActivityId = writingPre.rows[0]!.id;

    const objectivePre = await sql<{ objective_version_id: string }>`
      SELECT objective_version_id
      FROM content.activity_objectives
      WHERE activity_version_id = ${selectionActivityId}::uuid
      LIMIT 1
    `.execute(db);
    objectiveId = objectivePre.rows[0]!.objective_version_id;

    app = await createLearningApp({
      tokenVerifier: StubTokenVerifier.fromClaims("unused", {
        issuer: "https://example.test",
        subject: "sub",
        email: null,
        emailVerified: false,
      }),
    });

    await request(app.getHttpServer())
      .post("/v1/ops/content/releases")
      .set(TEST_ACTOR_HEADER, editorId)
      .set(TEST_ROLES_HEADER, "content_editor")
      .set("Idempotency-Key", createUuidV7())
      .send({
        releaseKey: imported.releaseKey,
        version: imported.releaseVersion,
        title: "Import smoke release",
        description: "DM-039 review fixture.",
        manifestSha256: imported.manifestSha256,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${imported.releaseId}/review-events`)
      .set(TEST_ACTOR_HEADER, submitterId)
      .set(TEST_ROLES_HEADER, "content_reviewer")
      .set("Idempotency-Key", createUuidV7())
      .send({ action: "submitted", validationResult: { ok: true } })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${imported.releaseId}/review-events`)
      .set(TEST_ACTOR_HEADER, reviewerId)
      .set(TEST_ROLES_HEADER, "content_reviewer")
      .set("Idempotency-Key", createUuidV7())
      .send({
        action: "approved",
        validationResult: { ok: true },
        qualification: "Qualified German-language reviewer",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${imported.releaseId}/publish`)
      .set(TEST_ACTOR_HEADER, reviewerId)
      .set(TEST_ROLES_HEADER, "content_reviewer")
      .set("Idempotency-Key", createUuidV7())
      .expect(200);
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await disposeDb();
  });

  async function createSession(userId: string = learnerId): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/v1/learning/sessions")
      .set(TEST_ACTOR_HEADER, userId)
      .set("Idempotency-Key", createUuidV7())
      .send({
        curriculumReleaseId: releaseId,
        unitVersionId: freeUnitId,
        lessonVersionId: lessonId,
        clientPlatform: "web",
      })
      .expect(201);
    return res.body.id as string;
  }

  it("schedules vocabulary success as scheduled and failure as due", async () => {
    const sessionId = await createSession();
    const selectionKey = await sql<{ answer_spec: { values: string[] } }>`
      SELECT answer_spec
      FROM content.answer_key_versions
      WHERE activity_version_id = ${selectionActivityId}::uuid
      LIMIT 1
    `.execute(db);
    const correctOption = selectionKey.rows[0]!.answer_spec.values[0];
    const wrongOption = `${correctOption}-wrong`;

    const passed = await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${sessionId}/attempts`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .send({
        activityVersionId: selectionActivityId,
        clientAttemptId: createUuidV7(),
        attemptNumber: 1,
        response: { responseKind: "choice", response: { selected: [correctOption] } },
      })
      .expect(201);
    expect(passed.body.score?.passed).toBe(true);

    const scheduled = await sql<{
      algorithm_version: string;
      state: string;
      interval_days: string;
      source_attempt_id: string;
    }>`
      SELECT algorithm_version, state, interval_days::text AS interval_days, source_attempt_id
      FROM learning.review_items
      WHERE user_id = ${learnerId}::uuid
        AND source_attempt_id = ${passed.body.id}::uuid
    `.execute(db);
    expect(scheduled.rows).toHaveLength(1);
    expect(scheduled.rows[0]?.algorithm_version).toBe(REVIEW_ALGORITHM_VERSION);
    expect(scheduled.rows[0]?.state).toBe("scheduled");
    expect(Number(scheduled.rows[0]?.interval_days)).toBe(1);

    const failed = await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${sessionId}/attempts`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .send({
        activityVersionId: selectionActivityId,
        clientAttemptId: createUuidV7(),
        attemptNumber: 2,
        response: { responseKind: "choice", response: { selected: [wrongOption] } },
      })
      .expect(201);
    expect(failed.body.score?.passed).toBe(false);

    const due = await sql<{ state: string; interval_days: string }>`
      SELECT state, interval_days::text AS interval_days
      FROM learning.review_items
      WHERE user_id = ${learnerId}::uuid
        AND source_attempt_id = ${failed.body.id}::uuid
    `.execute(db);
    expect(due.rows[0]?.state).toBe("due");
    expect(Number(due.rows[0]?.interval_days)).toBe(0);

    const listedDue = await request(app.getHttpServer())
      .get("/v1/learning/review-items")
      .query({ state: "due" })
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(200);
    expect(
      listedDue.body.items.some(
        (item: { sourceAttemptId: string }) => item.sourceAttemptId === failed.body.id,
      ),
    ).toBe(true);
    expect(listedDue.body.items[0]?.algorithmVersion).toBe(REVIEW_ALGORITHM_VERSION);

    const listedScheduled = await request(app.getHttpServer())
      .get("/v1/learning/review-items")
      .query({ state: "scheduled" })
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(200);
    expect(
      listedScheduled.body.items.some(
        (item: { sourceAttemptId: string }) => item.sourceAttemptId === passed.body.id,
      ),
    ).toBe(true);

    const otherView = await request(app.getHttpServer())
      .get("/v1/learning/review-items")
      .query({ state: "due" })
      .set(TEST_ACTOR_HEADER, otherLearnerId)
      .expect(200);
    expect(otherView.body.items).toHaveLength(0);
  });

  it("does not schedule from writing (no valid evidence) or invalid evidence", async () => {
    const sessionId = await createSession();
    const before = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM learning.review_items WHERE user_id = ${learnerId}::uuid
    `.execute(db);
    const beforeCount = before.rows[0]!.n;

    await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${sessionId}/attempts`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .send({
        activityVersionId: writingActivityId,
        clientAttemptId: createUuidV7(),
        attemptNumber: 1,
        response: { responseKind: "text", textContent: "Hallo Welt" },
      })
      .expect(202);

    const evidenceCount = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM learning.evidence
      WHERE user_id = ${learnerId}::uuid
        AND attempt_id IN (
          SELECT id FROM learning.activity_attempts
          WHERE activity_version_id = ${writingActivityId}::uuid
            AND user_id = ${learnerId}::uuid
        )
    `.execute(db);
    expect(evidenceCount.rows[0]?.n).toBe(0);

    const sessionRow = await sql<{ id: string }>`
      SELECT id FROM learning.sessions
      WHERE user_id = ${learnerId}::uuid
      ORDER BY started_at DESC
      LIMIT 1
    `.execute(db);

    const attemptId = createUuidV7();
    const evidenceId = createUuidV7();
    await sql`
      INSERT INTO learning.activity_attempts (
        id, user_id, session_id, activity_version_id, answer_key_version_id,
        attempt_number, client_attempt_id, status, submitted_at, algorithm_version,
        correlation_id
      ) VALUES (
        ${attemptId}::uuid,
        ${learnerId}::uuid,
        ${sessionRow.rows[0]!.id}::uuid,
        ${selectionActivityId}::uuid,
        NULL,
        90,
        ${createUuidV7()}::uuid,
        'scored'::learning.attempt_status,
        now(),
        'test.invalid',
        ${createUuidV7()}::uuid
      )
    `.execute(db);
    await sql`
      INSERT INTO learning.evidence (
        id, user_id, attempt_id, objective_version_id, score_ratio, validity,
        reason_code, observed_at, algorithm_version
      ) VALUES (
        ${evidenceId}::uuid,
        ${learnerId}::uuid,
        ${attemptId}::uuid,
        ${objectiveId}::uuid,
        0,
        'invalid'::learning.evidence_validity,
        'ai_unverified',
        now(),
        'test.invalid'
      )
    `.execute(db);

    const reviews = app.get(ReviewService);
    await reviews.applyEvidenceInTransaction(
      db,
      learnerId,
      [
        {
          evidenceId,
          attemptId,
          objectiveVersionId: objectiveId,
          skill: "vocabulary",
          scoreRatio: 0,
          validity: "invalid",
          observedAt: new Date(),
        },
      ],
      new Date(),
    );

    const after = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM learning.review_items WHERE user_id = ${learnerId}::uuid
    `.execute(db);
    expect(after.rows[0]?.n).toBe(beforeCount);
  });

  it("rebuilds review_items from append-only evidence matching live schedule fields", async () => {
    const sessionId = await createSession();
    const selectionKey = await sql<{ answer_spec: { values: string[] } }>`
      SELECT answer_spec
      FROM content.answer_key_versions
      WHERE activity_version_id = ${selectionActivityId}::uuid
      LIMIT 1
    `.execute(db);
    const correctOption = selectionKey.rows[0]!.answer_spec.values[0];

    await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${sessionId}/attempts`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .send({
        activityVersionId: selectionActivityId,
        clientAttemptId: createUuidV7(),
        attemptNumber: 10,
        response: { responseKind: "choice", response: { selected: [correctOption] } },
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${sessionId}/attempts`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .send({
        activityVersionId: selectionActivityId,
        clientAttemptId: createUuidV7(),
        attemptNumber: 11,
        response: {
          responseKind: "choice",
          response: { selected: [`${correctOption}-miss`] },
        },
      })
      .expect(201);

    const live = await sql<{
      objective_version_id: string;
      source_attempt_id: string;
      algorithm_version: string;
      due_at: Date;
      interval_days: string;
      ease: string;
      last_evidence_id: string;
    }>`
      SELECT
        objective_version_id,
        source_attempt_id,
        algorithm_version,
        due_at,
        interval_days::text AS interval_days,
        ease::text AS ease,
        last_evidence_id
      FROM learning.review_items
      WHERE user_id = ${learnerId}::uuid
        AND state IN ('due', 'scheduled', 'suspended')
      ORDER BY due_at ASC, objective_version_id ASC, source_attempt_id ASC
    `.execute(db);

    expect(live.rows.length).toBeGreaterThan(0);
    expect(live.rows.length).toBeLessThanOrEqual(MAX_ACTIVE_REVIEW_ITEMS);

    const asOf = new Date();
    const reviews = app.get(ReviewService);
    await reviews.rebuildForUser(db, learnerId, asOf);

    const rebuilt = await sql<{
      objective_version_id: string;
      source_attempt_id: string;
      algorithm_version: string;
      due_at: Date;
      interval_days: string;
      ease: string;
      last_evidence_id: string;
    }>`
      SELECT
        objective_version_id,
        source_attempt_id,
        algorithm_version,
        due_at,
        interval_days::text AS interval_days,
        ease::text AS ease,
        last_evidence_id
      FROM learning.review_items
      WHERE user_id = ${learnerId}::uuid
        AND state IN ('due', 'scheduled', 'suspended')
      ORDER BY due_at ASC, objective_version_id ASC, source_attempt_id ASC
    `.execute(db);

    expect(rebuilt.rows.length).toBe(live.rows.length);
    for (let i = 0; i < live.rows.length; i += 1) {
      const a = live.rows[i]!;
      const b = rebuilt.rows[i]!;
      expect(b.objective_version_id).toBe(a.objective_version_id);
      expect(b.source_attempt_id).toBe(a.source_attempt_id);
      expect(b.algorithm_version).toBe(a.algorithm_version);
      expect(b.last_evidence_id).toBe(a.last_evidence_id);
      expect(Number(b.interval_days)).toBe(Number(a.interval_days));
      expect(Number(b.ease)).toBe(Number(a.ease));
      expect(new Date(b.due_at).toISOString()).toBe(new Date(a.due_at).toISOString());
    }

    await reviews.rebuildForUser(db, learnerId, asOf);
    const again = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM learning.review_items WHERE user_id = ${learnerId}::uuid
    `.execute(db);
    expect(again.rows[0]?.n).toBe(rebuilt.rows.length);
  });
});
