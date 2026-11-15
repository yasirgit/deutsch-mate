/**
 * Deterministic scoring integration (DM-038): sessions, AnswerSpec kinds,
 * atomic score/evidence/progress/outbox, duplicate clientAttemptId.
 */

import "reflect-metadata";

import path from "node:path";

import { isProblemDetails } from "@deutsch-mate/api-schemas";
import { importRelease, validateRelease } from "@deutsch-mate/content-pipeline";
import { applyMigrations, createKysely, createPgPool, type Database } from "@deutsch-mate/database";
import { createUuidV7 } from "@deutsch-mate/domain";
import { DETERMINISTIC_ALGORITHM_VERSION } from "@deutsch-mate/scoring";
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
      ${`${id}@learning.test`},
      ${createUuidV7()}::uuid,
      'active',
      'en'
    )
  `.execute(db);
  for (const role of roles) {
    await sql`
      INSERT INTO iam.user_roles (id, user_id, role, reason)
      VALUES (${createUuidV7()}::uuid, ${id}::uuid, ${role}::iam.role_code, 'dm-038 test')
    `.execute(db);
  }
  return id;
}

type SpecCase = {
  readonly key: string;
  readonly answerSpec: Record<string, unknown>;
  readonly correct: Record<string, unknown>;
  readonly wrong: Record<string, unknown>;
};

const SPEC_CASES: readonly SpecCase[] = [
  {
    key: "exact",
    answerSpec: { kind: "exact", value: "Guten Tag" },
    correct: { value: "Guten Tag" },
    wrong: { value: "guten tag" },
  },
  {
    key: "case_folded",
    answerSpec: { kind: "case_folded", value: "Hallo" },
    correct: { value: "HALLO" },
    wrong: { value: "Hallo!" },
  },
  {
    key: "normalized",
    answerSpec: { kind: "normalized", value: "Guten Tag" },
    correct: { value: "guten  tag!" },
    wrong: { value: "Guten Abend" },
  },
  {
    key: "set",
    answerSpec: { kind: "set", values: ["opt_a", "opt_b"] },
    correct: { selected: ["opt_b", "opt_a"] },
    wrong: { selected: ["opt_a"] },
  },
  {
    key: "ordered",
    answerSpec: { kind: "ordered", order: ["a", "b", "c"] },
    correct: { order: ["a", "b", "c"] },
    wrong: { order: ["c", "b", "a"] },
  },
  {
    key: "matching",
    answerSpec: {
      kind: "matching",
      pairs: [
        { leftId: "l1", rightId: "r1" },
        { leftId: "l2", rightId: "r2" },
      ],
    },
    correct: {
      pairs: [
        { leftId: "l2", rightId: "r2" },
        { leftId: "l1", rightId: "r1" },
      ],
    },
    wrong: {
      pairs: [
        { leftId: "l1", rightId: "r2" },
        { leftId: "l2", rightId: "r1" },
      ],
    },
  },
  {
    key: "weighted_alternatives",
    answerSpec: {
      kind: "weighted_alternatives",
      alternatives: [
        { value: "Berlin", weight: "1.0", match: "case_folded" },
        { value: "berlin city", weight: "0.5", match: "normalized" },
      ],
    },
    correct: { value: "BERLIN" },
    wrong: { value: "Munich" },
  },
  {
    key: "cloze",
    answerSpec: {
      kind: "cloze",
      blanks: [
        { blankId: "b1", accept: { kind: "exact", value: "bin" } },
        { blankId: "b2", accept: { kind: "case_folded", value: "Student" } },
      ],
    },
    correct: { blanks: { b1: "bin", b2: "STUDENT" } },
    wrong: { blanks: { b1: "bist", b2: "Lehrer" } },
  },
];

describe("deterministic scoring integration", () => {
  let app: INestApplication;
  let disposeDb: () => Promise<void>;
  let db: Kysely<Database>;
  let learnerId: string;
  let editorId: string;
  let submitterId: string;
  let reviewerId: string;
  let releaseId: string;
  let freeUnitId: string;
  let lessonId: string;
  let selectionActivityId: string;
  let writingActivityId: string;
  let listeningActivityId: string;
  const specActivityIds = new Map<string, string>();

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    const harness = await createMigratedTestDatabase("deutsch_mate_dm038_scoring");
    disposeDb = harness.dispose;
    db = harness.db;
    const connectionString = harness.connectionString;
    process.env["DATABASE_URL"] = connectionString;
    process.env["REDIS_URL"] ??= "redis://localhost:63799";

    editorId = await seedUser(db, ["content_editor"]);
    submitterId = await seedUser(db, ["content_reviewer"]);
    reviewerId = await seedUser(db, ["content_reviewer"]);
    learnerId = await seedUser(db, ["learner"]);

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

    const listeningPre = await sql<{ id: string }>`
      SELECT id FROM content.activity_versions
      WHERE activity_key = 'act.a1.smoke.u1.listening' LIMIT 1
    `.execute(db);
    listeningActivityId = listeningPre.rows[0]!.id;

    let ordinal = 100;
    for (const specCase of SPEC_CASES) {
      const activityId = createUuidV7();
      const answerKeyId = createUuidV7();
      await sql`
        INSERT INTO content.activity_versions (
          id, activity_key, version, type, level, prompt, configuration,
          max_score, required, transcript_policy, created_by
        ) VALUES (
          ${activityId}::uuid,
          ${`act.a1.smoke.u1.spec.${specCase.key}`},
          1,
          'selection'::content.activity_type,
          'A1'::learner.cefr_level,
          ${JSON.stringify({ type: "doc", version: 1, blocks: [] })}::jsonb,
          '{}'::jsonb,
          1.000,
          true,
          NULL,
          ${editorId}::uuid
        )
      `.execute(db);
      await sql`
        INSERT INTO content.answer_key_versions (
          id, activity_version_id, version, scoring_algorithm_version,
          answer_spec, rationale, max_score, created_by
        ) VALUES (
          ${answerKeyId}::uuid,
          ${activityId}::uuid,
          1,
          ${DETERMINISTIC_ALGORITHM_VERSION},
          ${JSON.stringify(specCase.answerSpec)}::jsonb,
          '{}'::jsonb,
          1.000,
          ${editorId}::uuid
        )
      `.execute(db);
      await sql`
        INSERT INTO content.activity_objectives (activity_version_id, objective_version_id, weight)
        SELECT ${activityId}::uuid, ao.objective_version_id, 1.0
        FROM content.activity_objectives AS ao
        WHERE ao.activity_version_id = ${selectionActivityId}::uuid
        LIMIT 1
      `.execute(db);
      await sql`
        INSERT INTO content.lesson_activities (lesson_version_id, activity_version_id, ordinal)
        VALUES (${lessonId}::uuid, ${activityId}::uuid, ${ordinal})
      `.execute(db);
      specActivityIds.set(specCase.key, activityId);
      ordinal += 1;
    }

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
        description: "DM-038 scoring fixture.",
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

  async function createSession(): Promise<{ id: string; etag: string }> {
    const res = await request(app.getHttpServer())
      .post("/v1/learning/sessions")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .send({
        curriculumReleaseId: releaseId,
        unitVersionId: freeUnitId,
        lessonVersionId: lessonId,
        clientPlatform: "web",
      })
      .expect(201);
    expect(res.body.status).toBe("active");
    expect(res.headers["etag"]).toMatch(/^"[1-9][0-9]*"$/);
    return { id: res.body.id as string, etag: res.headers["etag"] as string };
  }

  it("creates, lists, gets, and updates learning sessions", async () => {
    const created = await createSession();

    const listed = await request(app.getHttpServer())
      .get("/v1/learning/sessions")
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(200);
    expect(listed.body.items.some((s: { id: string }) => s.id === created.id)).toBe(true);

    const got = await request(app.getHttpServer())
      .get(`/v1/learning/sessions/${created.id}`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(200);
    expect(got.body.id).toBe(created.id);
    expect(got.headers["etag"]).toBe(created.etag);

    const patched = await request(app.getHttpServer())
      .patch(`/v1/learning/sessions/${created.id}`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("If-Match", created.etag)
      .set("Content-Type", "application/merge-patch+json")
      .send({ status: "completed" })
      .expect(200);
    expect(patched.body.status).toBe("completed");
    expect(patched.headers["etag"]).not.toBe(created.etag);
  });

  it("scores every AnswerSpec kind against published content", async () => {
    const session = await createSession();

    for (const specCase of SPEC_CASES) {
      const activityId = specActivityIds.get(specCase.key);
      expect(activityId).toBeTruthy();

      const correct = await request(app.getHttpServer())
        .post(`/v1/learning/sessions/${session.id}/attempts`)
        .set(TEST_ACTOR_HEADER, learnerId)
        .set("Idempotency-Key", createUuidV7())
        .send({
          activityVersionId: activityId,
          clientAttemptId: createUuidV7(),
          attemptNumber: 1,
          response: { responseKind: "structured", response: specCase.correct },
        })
        .expect(201);

      expect(correct.body.status).toBe("completed");
      expect(correct.body.algorithmVersion).toBe(DETERMINISTIC_ALGORITHM_VERSION);
      expect(correct.body.score?.passed).toBe(true);
      expect(correct.body.score?.scoringMethod).toBe("deterministic");
      expect(correct.body.feedback?.feedbackKind).toBe("deterministic");

      const evidence = await sql<{ validity: string; algorithm_version: string }>`
        SELECT validity::text AS validity, algorithm_version
        FROM learning.evidence
        WHERE attempt_id = ${correct.body.id}::uuid
      `.execute(db);
      expect(evidence.rows.length).toBeGreaterThan(0);
      expect(evidence.rows.every((r) => r.validity === "valid")).toBe(true);
      expect(evidence.rows[0]?.algorithm_version).toBe(DETERMINISTIC_ALGORITHM_VERSION);

      const wrongSession = await createSession();
      const wrong = await request(app.getHttpServer())
        .post(`/v1/learning/sessions/${wrongSession.id}/attempts`)
        .set(TEST_ACTOR_HEADER, learnerId)
        .set("Idempotency-Key", createUuidV7())
        .send({
          activityVersionId: activityId,
          clientAttemptId: createUuidV7(),
          attemptNumber: 2,
          response: { responseKind: "structured", response: specCase.wrong },
        })
        .expect(201);
      expect(wrong.body.score?.passed).toBe(false);
    }

    const progress = await sql<{ completed_required: number; required_total: number }>`
      SELECT completed_required, required_total
      FROM learning.unit_progress
      WHERE user_id = ${learnerId}::uuid
        AND unit_version_id = ${freeUnitId}::uuid
    `.execute(db);
    expect(progress.rows[0]?.completed_required).toBeGreaterThan(0);
    expect(progress.rows[0]?.required_total).toBeGreaterThan(0);

    const outbox = await sql<{ event_type: string }>`
      SELECT event_type FROM ops.outbox_events
      WHERE event_type = 'learning.attempt.scored.v1'
      LIMIT 1
    `.execute(db);
    expect(outbox.rows[0]?.event_type).toBe("learning.attempt.scored.v1");
  });

  it("scores import-smoke selection and listening; writing stays feedback_unavailable", async () => {
    const session = await createSession();

    const selectionKey = await sql<{ answer_spec: { values: string[] } }>`
      SELECT answer_spec
      FROM content.answer_key_versions
      WHERE activity_version_id = ${selectionActivityId}::uuid
      LIMIT 1
    `.execute(db);
    const correctOption = selectionKey.rows[0]!.answer_spec.values[0];

    const scored = await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${session.id}/attempts`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .send({
        activityVersionId: selectionActivityId,
        clientAttemptId: createUuidV7(),
        attemptNumber: 1,
        durationMs: 1200,
        response: { responseKind: "choice", response: { selected: [correctOption] } },
      })
      .expect(201);
    expect(scored.body.status).toBe("completed");
    expect(scored.body.answerKeyVersionId).toBeTruthy();

    const listening = await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${session.id}/attempts`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .send({
        activityVersionId: listeningActivityId,
        clientAttemptId: createUuidV7(),
        attemptNumber: 1,
        response: { responseKind: "choice", response: { selected: ["hallo"] } },
      })
      .expect(201);
    expect(listening.body.status).toBe("completed");
    expect(listening.body.score?.passed).toBe(true);

    const writing = await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${session.id}/attempts`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .send({
        activityVersionId: writingActivityId,
        clientAttemptId: createUuidV7(),
        attemptNumber: 1,
        response: {
          responseKind: "text",
          textContent: "Ich wohne seit zwei Jahren in Berlin.",
        },
      })
      .expect(202);
    expect(writing.body.status).toBe("feedback_unavailable");
    expect(writing.body.score).toBeNull();
    expect(writing.headers["location"]).toContain(`/v1/learning/attempts/${writing.body.id}`);

    const writingEvidence = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM learning.evidence
      WHERE attempt_id = ${writing.body.id}::uuid
        AND validity = 'valid'
    `.execute(db);
    expect(writingEvidence.rows[0]?.n).toBe(0);

    const fetched = await request(app.getHttpServer())
      .get(`/v1/learning/attempts/${scored.body.id}`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(200);
    expect(fetched.body.id).toBe(scored.body.id);
  });

  it("returns one attempt for duplicate Idempotency-Key and clientAttemptId", async () => {
    const session = await createSession();
    const clientAttemptId = createUuidV7();
    const idempotencyKey = createUuidV7();
    const body = {
      activityVersionId: selectionActivityId,
      clientAttemptId,
      attemptNumber: 90,
      response: { responseKind: "choice", response: { selected: ["opt_a_01"] } },
    };

    const first = await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${session.id}/attempts`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", idempotencyKey)
      .send(body)
      .expect(201);

    const replay = await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${session.id}/attempts`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", idempotencyKey)
      .send(body)
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);

    const duplicateClient = await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${session.id}/attempts`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .send(body)
      .expect(200);
    expect(duplicateClient.body.id).toBe(first.body.id);

    const conflict = await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${session.id}/attempts`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", idempotencyKey)
      .send({ ...body, attemptNumber: 91, clientAttemptId: createUuidV7() });
    expect(conflict.status).toBe(409);
    expect(isProblemDetails(conflict.body)).toBe(true);
  });
});
