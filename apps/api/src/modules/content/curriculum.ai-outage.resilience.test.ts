/**
 * AI-outage resilience (DM-032): curriculum GETs succeed when AI config is
 * absent / kill-switched. Deterministic curriculum path must not depend on AI.
 */

import "reflect-metadata";

import path from "node:path";

import { importRelease, validateRelease } from "@deutsch-mate/content-pipeline";
import { applyMigrations, createKysely, createPgPool, type Database } from "@deutsch-mate/database";
import { createUuidV7 } from "@deutsch-mate/domain";
import type { INestApplication } from "@nestjs/common";
import { sql, type Kysely } from "kysely";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  TEST_ACTOR_HEADER,
  TEST_ROLES_HEADER,
} from "../../platform/auth/auth.guard.js";
import { createContentApp } from "./testing/create-content-app.test.js";
import { StubTokenVerifier } from "../identity/testing/oidc-test-keys.js";

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

async function seedStaffUser(
  db: Kysely<Database>,
  roles: readonly ("content_editor" | "content_reviewer" | "learner")[],
): Promise<string> {
  const id = createUuidV7();
  await sql`
    INSERT INTO iam.users (id, primary_email, pseudonym_key, status)
    VALUES (
      ${id}::uuid,
      ${`${id}@ai-outage.test`},
      ${createUuidV7()}::uuid,
      'active'
    )
  `.execute(db);
  for (const role of roles) {
    await sql`
      INSERT INTO iam.user_roles (id, user_id, role, reason)
      VALUES (${createUuidV7()}::uuid, ${id}::uuid, ${role}::iam.role_code, 'dm-032 ai-outage')
    `.execute(db);
  }
  return id;
}

describe("ai-outage resilience (curriculum)", () => {
  let app: INestApplication;
  let disposeDb: () => Promise<void>;
  let learnerId: string;
  let releaseId: string;
  let freeUnitId: string;
  let freeLessonId: string;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    // Simulate AI outage / missing provider config / kill switch.
    delete process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_BASE_URL"];
    process.env["AI_KILL_SWITCH"] = "1";
    process.env["AI_GATEWAY_DISABLED"] = "true";

    const harness = await createMigratedTestDatabase("deutsch_mate_dm032_ai_outage");
    disposeDb = harness.dispose;
    const db = harness.db;
    const connectionString = harness.connectionString;
    process.env["DATABASE_URL"] = connectionString;
    process.env["REDIS_URL"] ??= "redis://localhost:63799";

    const editorId = await seedStaffUser(db, ["content_editor"]);
    const submitterId = await seedStaffUser(db, ["content_reviewer"]);
    const reviewerId = await seedStaffUser(db, ["content_reviewer"]);
    learnerId = await seedStaffUser(db, ["learner"]);

    const validated = validateRelease({ dir: smokeDir, writeManifestFile: false });
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

    app = await createContentApp({
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
        title: "AI outage smoke",
        description: "Curriculum must work without AI.",
        manifestSha256: imported.manifestSha256,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${releaseId}/review-events`)
      .set(TEST_ACTOR_HEADER, submitterId)
      .set(TEST_ROLES_HEADER, "content_reviewer")
      .set("Idempotency-Key", createUuidV7())
      .send({ action: "submitted", validationResult: { ok: true } })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${releaseId}/review-events`)
      .set(TEST_ACTOR_HEADER, reviewerId)
      .set(TEST_ROLES_HEADER, "content_reviewer")
      .set("Idempotency-Key", createUuidV7())
      .send({
        action: "approved",
        validationResult: { ok: true },
        qualification: "Reviewer",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${releaseId}/publish`)
      .set(TEST_ACTOR_HEADER, reviewerId)
      .set(TEST_ROLES_HEADER, "content_reviewer")
      .set("Idempotency-Key", createUuidV7())
      .expect(200);

    const freeUnit = await sql<{ id: string }>`
      SELECT id FROM content.unit_versions WHERE unit_key = 'unit.a1.smoke.u1' LIMIT 1
    `.execute(db);
    freeUnitId = freeUnit.rows[0]!.id;
    const freeLesson = await sql<{ id: string }>`
      SELECT lv.id
      FROM content.unit_lessons AS ul
      JOIN content.lesson_versions AS lv ON lv.id = ul.lesson_version_id
      WHERE ul.unit_version_id = ${freeUnitId}::uuid
      ORDER BY ul.ordinal
      LIMIT 1
    `.execute(db);
    freeLessonId = freeLesson.rows[0]!.id;
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await disposeDb();
  });

  it("curriculum GETs succeed with AI env down / kill switch on", async () => {
    expect(process.env["OPENAI_API_KEY"]).toBeUndefined();
    expect(process.env["AI_KILL_SWITCH"]).toBe("1");

    const current = await request(app.getHttpServer())
      .get("/v1/curriculum/releases/current")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner")
      .expect(200);
    expect(current.body.id).toBe(releaseId);

    await request(app.getHttpServer())
      .get(`/v1/curriculum/releases/${releaseId}/modules`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner")
      .expect(200);

    await request(app.getHttpServer())
      .get(`/v1/curriculum/units/${freeUnitId}`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner")
      .expect(200);

    await request(app.getHttpServer())
      .get(`/v1/curriculum/lessons/${freeLessonId}`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner")
      .expect(200);
  });
});
