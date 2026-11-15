/**
 * Learning duplicate-delivery resilience (DM-038): same Idempotency-Key and
 * same clientAttemptId yield one attempt resource.
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
      ${`${id}@learning-dup.test`},
      ${createUuidV7()}::uuid,
      'active',
      'en'
    )
  `.execute(db);
  for (const role of roles) {
    await sql`
      INSERT INTO iam.user_roles (id, user_id, role, reason)
      VALUES (${createUuidV7()}::uuid, ${id}::uuid, ${role}::iam.role_code, 'dm-038 dup')
    `.execute(db);
  }
  return id;
}

describe("learning duplicates resilience", () => {
  let app: INestApplication;
  let disposeDb: () => Promise<void>;
  let learnerId: string;
  let releaseId: string;
  let freeUnitId: string;
  let selectionActivityId: string;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    const harness = await createMigratedTestDatabase("deutsch_mate_dm038_dup");
    disposeDb = harness.dispose;
    const db = harness.db;
    const connectionString = harness.connectionString;
    process.env["DATABASE_URL"] = connectionString;
    process.env["REDIS_URL"] ??= "redis://localhost:63799";

    const editorId = await seedUser(db, ["content_editor"]);
    const submitterId = await seedUser(db, ["content_reviewer"]);
    const reviewerId = await seedUser(db, ["content_reviewer"]);
    learnerId = await seedUser(db, ["learner"]);

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
        title: "Dup smoke",
        description: "DM-038 duplicates.",
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

    freeUnitId = (
      await sql<{ id: string }>`
        SELECT id FROM content.unit_versions WHERE unit_key = 'unit.a1.smoke.u1' LIMIT 1
      `.execute(db)
    ).rows[0]!.id;
    selectionActivityId = (
      await sql<{ id: string }>`
        SELECT id FROM content.activity_versions
        WHERE activity_key = 'act.a1.smoke.u1.sel01' LIMIT 1
      `.execute(db)
    ).rows[0]!.id;
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await disposeDb();
  });

  it("dedupes Idempotency-Key replay and clientAttemptId collisions", async () => {
    const session = await request(app.getHttpServer())
      .post("/v1/learning/sessions")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .send({
        curriculumReleaseId: releaseId,
        unitVersionId: freeUnitId,
        clientPlatform: "web",
      })
      .expect(201);

    const clientAttemptId = createUuidV7();
    const idempotencyKey = createUuidV7();
    const body = {
      activityVersionId: selectionActivityId,
      clientAttemptId,
      attemptNumber: 1,
      response: { responseKind: "choice", response: { selected: ["opt_a_01"] } },
    };

    const first = await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${session.body.id}/attempts`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", idempotencyKey)
      .send(body)
      .expect(201);

    const replay = await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${session.body.id}/attempts`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", idempotencyKey)
      .send(body)
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);

    const clientDup = await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${session.body.id}/attempts`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .send(body)
      .expect(200);
    expect(clientDup.body.id).toBe(first.body.id);
  });
});
