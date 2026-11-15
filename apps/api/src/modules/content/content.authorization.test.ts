/**
 * Content authorization tests (DM-031): role gates for content:write / content:review;
 * drafts never visible to learners; actor never from request fields.
 */

import "reflect-metadata";

import path from "node:path";

import { isProblemDetails } from "@deutsch-mate/api-schemas";
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
const SHA =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

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
  roles: readonly string[],
): Promise<string> {
  const id = createUuidV7();
  await sql`
    INSERT INTO iam.users (id, primary_email, pseudonym_key, status)
    VALUES (${id}::uuid, ${`${id}@authz.test`}, ${createUuidV7()}::uuid, 'active')
  `.execute(db);
  for (const role of roles) {
    await sql`
      INSERT INTO iam.user_roles (id, user_id, role, reason)
      VALUES (${createUuidV7()}::uuid, ${id}::uuid, ${role}::iam.role_code, 'dm-031 authz')
    `.execute(db);
  }
  return id;
}

describe("content authorization", () => {
  let app: INestApplication;
  let disposeDb: () => Promise<void>;
  let db: Kysely<Database>;
  let editorId: string;
  let reviewerId: string;
  let learnerId: string;
  let draftId: string;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    const harness = await createMigratedTestDatabase("deutsch_mate_dm031_authz");
    disposeDb = harness.dispose;
    db = harness.db;
    process.env["DATABASE_URL"] = harness.connectionString;
    process.env["REDIS_URL"] ??= "redis://localhost:63799";

    editorId = await seedUser(db, ["content_editor"]);
    reviewerId = await seedUser(db, ["content_reviewer"]);
    learnerId = await seedUser(db, ["learner"]);

    draftId = createUuidV7();
    await sql`
      INSERT INTO content.curriculum_releases (
        id, release_key, version, status, title, description, manifest_sha256, created_by
      ) VALUES (
        ${draftId}::uuid,
        'authz.draft',
        1,
        'draft'::content.release_status,
        'Draft',
        'Hidden from learners',
        ${SHA},
        ${editorId}::uuid
      )
    `.execute(db);

    app = await createContentApp({
      tokenVerifier: StubTokenVerifier.fromClaims("unused", {
        issuer: "https://example.test",
        subject: "sub",
        email: null,
        emailVerified: false,
      }),
    });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await disposeDb();
  });

  it("learner cannot create releases (content:write)", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/ops/content/releases")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner")
      .set("Idempotency-Key", createUuidV7())
      .send({
        releaseKey: "authz.denied",
        version: 1,
        title: "Nope",
        description: "Denied",
        manifestSha256: SHA,
      });
    expect(res.status).toBe(403);
    expect(isProblemDetails(res.body)).toBe(true);
    expect(res.body.code).toBe("forbidden");
  });

  it("content_editor cannot approve (content:review) without reviewer role", async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${draftId}/review-events`)
      .set(TEST_ACTOR_HEADER, editorId)
      .set(TEST_ROLES_HEADER, "content_editor")
      .set("Idempotency-Key", createUuidV7())
      .send({ action: "approved", validationResult: { ok: true } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
  });

  it("content_reviewer can submit; drafts stay invisible on learner route", async () => {
    await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${draftId}/review-events`)
      .set(TEST_ACTOR_HEADER, reviewerId)
      .set(TEST_ROLES_HEADER, "content_reviewer")
      .set("Idempotency-Key", createUuidV7())
      .send({ action: "submitted", validationResult: { ok: true } })
      .expect(201);

    const current = await request(app.getHttpServer())
      .get("/v1/curriculum/releases/current")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner")
      .expect(404);
    expect(isProblemDetails(current.body)).toBe(true);

    // Spoofed userId in body must not change actor for review.
    const spoof = createUuidV7();
    const spoofed = await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${draftId}/review-events`)
      .set(TEST_ACTOR_HEADER, reviewerId)
      .set(TEST_ROLES_HEADER, "content_reviewer")
      .set("Idempotency-Key", createUuidV7())
      .send({
        action: "rejected",
        validationResult: { ok: false },
        userId: spoof,
        actorUserId: spoof,
      });
    // Reject unknown fields → 400, proving actor fields are not accepted.
    expect(spoofed.status).toBe(400);
    expect(spoofed.body.code).toBe("validation_failed");
  });
});
