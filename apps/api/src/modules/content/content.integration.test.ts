/**
 * Content publication integration tests (DM-031): import draft → review →
 * publish (SERIALIZABLE) → learner visibility → rollback without history rewrite.
 */

import "reflect-metadata";

import path from "node:path";

import { isProblemDetails } from "@deutsch-mate/api-schemas";
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
      ${`${id}@content.test`},
      ${createUuidV7()}::uuid,
      'active'
    )
  `.execute(db);
  for (const role of roles) {
    await sql`
      INSERT INTO iam.user_roles (id, user_id, role, reason)
      VALUES (${createUuidV7()}::uuid, ${id}::uuid, ${role}::iam.role_code, 'dm-031 test')
    `.execute(db);
  }
  return id;
}

describe("content-publication integration", () => {
  let app: INestApplication;
  let disposeDb: () => Promise<void>;
  let db: Kysely<Database>;
  let connectionString: string;
  let editorId: string;
  let submitterId: string;
  let reviewerId: string;
  let learnerId: string;
  let releaseId: string;
  let manifestSha256: string;
  let releaseKey: string;
  let releaseVersion: number;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    const harness = await createMigratedTestDatabase("deutsch_mate_dm031_content");
    disposeDb = harness.dispose;
    db = harness.db;
    connectionString = harness.connectionString;
    process.env["DATABASE_URL"] = connectionString;
    process.env["REDIS_URL"] ??= "redis://localhost:63799";

    editorId = await seedStaffUser(db, ["content_editor"]);
    submitterId = await seedStaffUser(db, ["content_reviewer"]);
    reviewerId = await seedStaffUser(db, ["content_reviewer"]);
    learnerId = await seedStaffUser(db, ["learner"]);

    const validated = validateRelease({ dir: smokeDir, writeManifestFile: false });
    expect(validated.inventory.ok).toBe(true);
    const imported = await importRelease({
      connectionString,
      loaded: validated.loaded,
      importerEmail: `${editorId}@importer.test`,
    });
    // Re-bind created_by to editor so self-approval checks use known actor.
    await sql`
      UPDATE content.curriculum_releases
      SET created_by = ${editorId}::uuid
      WHERE id = ${imported.releaseId}::uuid
    `.execute(db);

    releaseId = imported.releaseId;
    manifestSha256 = imported.manifestSha256;
    releaseKey = imported.releaseKey;
    releaseVersion = imported.releaseVersion;

    app = await createContentApp({
      tokenVerifier: StubTokenVerifier.fromClaims("unused", {
        issuer: "https://example.test",
        subject: "sub",
        email: null,
        emailVerified: false,
      }),
    });
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await disposeDb();
  });

  it("registers imported draft via create (idempotent) and hides drafts from learners", async () => {
    const create = await request(app.getHttpServer())
      .post("/v1/ops/content/releases")
      .set(TEST_ACTOR_HEADER, editorId)
      .set(TEST_ROLES_HEADER, "content_editor")
      .set("Idempotency-Key", createUuidV7())
      .send({
        releaseKey,
        version: releaseVersion,
        title: "Import smoke release",
        description: "Deterministic fixture for content validate/manifest/import (DM-030).",
        manifestSha256,
      })
      .expect(201);

    expect(create.body.id).toBe(releaseId);
    expect(create.body.status).toBe("draft");

    const learner = await request(app.getHttpServer())
      .get("/v1/curriculum/releases/current")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner")
      .expect(404);
    expect(isProblemDetails(learner.body)).toBe(true);
  });

  it("blocks creator/submitter self-approval then publishes after independent approve", async () => {
    await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${releaseId}/review-events`)
      .set(TEST_ACTOR_HEADER, submitterId)
      .set(TEST_ROLES_HEADER, "content_reviewer")
      .set("Idempotency-Key", createUuidV7())
      .send({ action: "submitted", validationResult: { ok: true } })
      .expect(201);

    const creatorApprove = await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${releaseId}/review-events`)
      .set(TEST_ACTOR_HEADER, editorId)
      .set(TEST_ROLES_HEADER, "content_editor,content_reviewer")
      .set("Idempotency-Key", createUuidV7())
      .send({ action: "approved", validationResult: { ok: true }, qualification: "CEFR A1" });
    expect(creatorApprove.status).toBe(403);
    expect(creatorApprove.body.code).toBe("forbidden");

    const submitterApprove = await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${releaseId}/review-events`)
      .set(TEST_ACTOR_HEADER, submitterId)
      .set(TEST_ROLES_HEADER, "content_reviewer")
      .set("Idempotency-Key", createUuidV7())
      .send({ action: "approved", validationResult: { ok: true } });
    expect(submitterApprove.status).toBe(403);

    const approved = await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${releaseId}/review-events`)
      .set(TEST_ACTOR_HEADER, reviewerId)
      .set(TEST_ROLES_HEADER, "content_reviewer")
      .set("Idempotency-Key", createUuidV7())
      .send({
        action: "approved",
        validationResult: { inventory: "ok" },
        qualification: "Qualified German-language reviewer",
      })
      .expect(201);
    expect(approved.body.action).toBe("approved");

    const published = await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${releaseId}/publish`)
      .set(TEST_ACTOR_HEADER, reviewerId)
      .set(TEST_ROLES_HEADER, "content_reviewer")
      .set("Idempotency-Key", createUuidV7())
      .expect(200);

    expect(published.body.status).toBe("published");
    expect(published.body.manifestSha256).toBe(manifestSha256);
    expect(published.body.publishedAt).toBeTruthy();

    const current = await request(app.getHttpServer())
      .get("/v1/curriculum/releases/current")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner")
      .expect(200);
    expect(current.body.id).toBe(releaseId);
    expect(current.body.status).toBe("published");

    const audit = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM ops.audit_events
      WHERE resource_id = ${releaseId}::uuid AND action = 'content.release.publish'
    `.execute(db);
    expect(audit.rows[0]?.n).toBeGreaterThanOrEqual(1);

    const outbox = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM ops.outbox_events
      WHERE aggregate_id = ${releaseId}::uuid
        AND event_type = 'content.curriculum_release.published.v1'
    `.execute(db);
    expect(outbox.rows[0]?.n).toBe(1);
  });

  it("rollback selects prior approved release without rewriting immutable history", async () => {
    // Second release version: clone by importing is same key/version — create a
    // second synthetic approved+published path via SQL copy of membership.
    const release2Id = createUuidV7();
    await sql`
      INSERT INTO content.curriculum_releases (
        id, release_key, version, status, title, description, manifest_sha256,
        approved_by, approved_at, created_by
      ) VALUES (
        ${release2Id}::uuid,
        ${releaseKey},
        ${releaseVersion + 1},
        'approved'::content.release_status,
        'Smoke v2',
        'Successor',
        ${manifestSha256},
        ${reviewerId}::uuid,
        now(),
        ${editorId}::uuid
      )
    `.execute(db);

    await sql`
      INSERT INTO content.release_modules (release_id, module_version_id, ordinal)
      SELECT ${release2Id}::uuid, module_version_id, ordinal
      FROM content.release_modules
      WHERE release_id = ${releaseId}::uuid
    `.execute(db);

    await sql`
      INSERT INTO content.review_events (
        id, aggregate_type, aggregate_id, action, actor_user_id,
        validation_result, correlation_id
      ) VALUES (
        ${createUuidV7()}::uuid,
        'curriculum_release',
        ${release2Id}::uuid,
        'approved',
        ${reviewerId}::uuid,
        '{"ok":true}'::jsonb,
        ${createUuidV7()}::uuid
      )
    `.execute(db);

    const published2 = await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${release2Id}/publish`)
      .set(TEST_ACTOR_HEADER, reviewerId)
      .set(TEST_ROLES_HEADER, "content_reviewer")
      .set("Idempotency-Key", createUuidV7())
      .expect(200);
    expect(published2.body.status).toBe("published");

    const v1 = await sql<{ status: string; retired_at: Date | null }>`
      SELECT status::text AS status, retired_at
      FROM content.curriculum_releases WHERE id = ${releaseId}::uuid
    `.execute(db);
    expect(v1.rows[0]?.status).toBe("retired");
    expect(v1.rows[0]?.retired_at).toBeTruthy();

    const rolled = await request(app.getHttpServer())
      .post(`/v1/ops/content/releases/${releaseId}/rollback`)
      .set(TEST_ACTOR_HEADER, reviewerId)
      .set(TEST_ROLES_HEADER, "content_reviewer")
      .set("Idempotency-Key", createUuidV7())
      .expect(200);

    expect(rolled.body.id).toBe(releaseId);
    expect(rolled.body.status).toBe("published");
    expect(rolled.body.retiredAt).toBeNull();

    const v2 = await sql<{ status: string }>`
      SELECT status::text AS status
      FROM content.curriculum_releases WHERE id = ${release2Id}::uuid
    `.execute(db);
    expect(v2.rows[0]?.status).toBe("retired");

    // Immutable content versions untouched (module still linked; no delete).
    const modules = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM content.release_modules
      WHERE release_id = ${releaseId}::uuid
    `.execute(db);
    expect(modules.rows[0]?.n).toBe(1);

    const events = await sql<{ action: string }>`
      SELECT action FROM content.review_events
      WHERE aggregate_id = ${releaseId}::uuid AND action = 'rollback_selected'
    `.execute(db);
    expect(events.rows.length).toBeGreaterThanOrEqual(1);

    const current = await request(app.getHttpServer())
      .get("/v1/curriculum/releases/current")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner")
      .expect(200);
    expect(current.body.id).toBe(releaseId);
  });
});
