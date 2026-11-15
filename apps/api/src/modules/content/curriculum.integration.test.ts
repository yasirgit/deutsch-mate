/**
 * Curriculum integration tests (DM-032): import-smoke → publish → learner
 * delivery with entitlement filtering, ETags, listening metadata, draft hide.
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
      ${`${id}@curriculum.test`},
      ${createUuidV7()}::uuid,
      'active'
    )
  `.execute(db);
  for (const role of roles) {
    await sql`
      INSERT INTO iam.user_roles (id, user_id, role, reason)
      VALUES (${createUuidV7()}::uuid, ${id}::uuid, ${role}::iam.role_code, 'dm-032 test')
    `.execute(db);
  }
  return id;
}

describe("curriculum integration", () => {
  let app: INestApplication;
  let disposeDb: () => Promise<void>;
  let db: Kysely<Database>;
  let editorId: string;
  let submitterId: string;
  let reviewerId: string;
  let learnerId: string;
  let releaseId: string;
  let freeUnitId: string;
  let premiumUnitId: string;
  let freeLessonId: string;
  let premiumLessonId: string;
  let draftReleaseId: string;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    const harness = await createMigratedTestDatabase("deutsch_mate_dm032_curriculum");
    disposeDb = harness.dispose;
    db = harness.db;
    const connectionString = harness.connectionString;
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
        title: "Import smoke release",
        description: "DM-032 curriculum delivery fixture.",
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
        qualification: "Qualified German-language reviewer",
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
    const premiumUnit = await sql<{ id: string }>`
      SELECT id FROM content.unit_versions WHERE unit_key = 'unit.a1.smoke.u2' LIMIT 1
    `.execute(db);
    freeUnitId = freeUnit.rows[0]!.id;
    premiumUnitId = premiumUnit.rows[0]!.id;

    const freeLesson = await sql<{ id: string }>`
      SELECT lv.id
      FROM content.unit_lessons AS ul
      JOIN content.lesson_versions AS lv ON lv.id = ul.lesson_version_id
      WHERE ul.unit_version_id = ${freeUnitId}::uuid
      ORDER BY ul.ordinal
      LIMIT 1
    `.execute(db);
    const premiumLesson = await sql<{ id: string }>`
      SELECT lv.id
      FROM content.unit_lessons AS ul
      JOIN content.lesson_versions AS lv ON lv.id = ul.lesson_version_id
      WHERE ul.unit_version_id = ${premiumUnitId}::uuid
      ORDER BY ul.ordinal
      LIMIT 1
    `.execute(db);
    freeLessonId = freeLesson.rows[0]!.id;
    premiumLessonId = premiumLesson.rows[0]!.id;

    draftReleaseId = createUuidV7();
    await sql`
      INSERT INTO content.curriculum_releases (
        id, release_key, version, status, title, description, manifest_sha256, created_by
      ) VALUES (
        ${draftReleaseId}::uuid,
        'draft.hidden',
        1,
        'draft'::content.release_status,
        'Draft',
        'Must stay hidden',
        ${imported.manifestSha256},
        ${editorId}::uuid
      )
    `.execute(db);
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await disposeDb();
  });

  it("serves current published release with immutable ETag and 304", async () => {
    const current = await request(app.getHttpServer())
      .get("/v1/curriculum/releases/current")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner")
      .expect(200);

    expect(current.body.id).toBe(releaseId);
    expect(current.body.status).toBe("published");
    expect(current.headers["etag"]).toMatch(/^"[0-9a-f]{64}"$/);

    await request(app.getHttpServer())
      .get("/v1/curriculum/releases/current")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner")
      .set("If-None-Match", current.headers["etag"] as string)
      .expect(304);
  });

  it("lists published modules with free/premium lock flags", async () => {
    const page = await request(app.getHttpServer())
      .get(`/v1/curriculum/releases/${releaseId}/modules`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner")
      .expect(200);

    expect(page.body.items.length).toBeGreaterThanOrEqual(1);
    const mod = page.body.items[0];
    expect(mod.units.length).toBe(6);
    const free = mod.units.find((u: { unitKey: string }) => u.unitKey === "unit.a1.smoke.u1");
    const premium = mod.units.find((u: { unitKey: string }) => u.unitKey === "unit.a1.smoke.u2");
    expect(free.accessTier).toBe("free");
    expect(free.locked).toBe(false);
    expect(premium.accessTier).toBe("premium");
    expect(premium.locked).toBe(true);
  });

  it("hides draft and non-published release module lists", async () => {
    const draft = await request(app.getHttpServer())
      .get(`/v1/curriculum/releases/${draftReleaseId}/modules`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner");
    expect(draft.status).toBe(404);
    expect(isProblemDetails(draft.body)).toBe(true);
  });

  it("resolves free unit/lesson with listening transcriptPolicy and approved assets", async () => {
    const unit = await request(app.getHttpServer())
      .get(`/v1/curriculum/units/${freeUnitId}`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner")
      .expect(200);

    expect(unit.body.id).toBe(freeUnitId);
    expect(unit.body.lessons.length).toBeGreaterThanOrEqual(1);
    expect(unit.body.objectives.length).toBeGreaterThanOrEqual(1);
    expect(unit.body.objectives[0].cefrDescriptors.length).toBeGreaterThanOrEqual(1);
    expect(unit.headers["etag"]).toMatch(/^"[0-9a-f]{64}"$/);

    const lesson = await request(app.getHttpServer())
      .get(`/v1/curriculum/lessons/${freeLessonId}`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner")
      .expect(200);

    expect(lesson.body.id).toBe(freeLessonId);
    const listening = lesson.body.activities.find(
      (a: { type: string }) => a.type === "listening",
    );
    expect(listening).toBeTruthy();
    expect(listening.transcriptPolicy).toBe("after_first_submission");
    expect(Array.isArray(listening.assets)).toBe(true);
    expect(listening.assets.length).toBeGreaterThanOrEqual(1);
    expect(listening.assets[0].mediaObjectId).toBeTruthy();
    expect(listening.assets[0].contentType).toBeTruthy();
    expect(listening.assets[0].transcriptAvailable).toBe(false);
    expect(listening.assets[0].bucket).toBeUndefined();
    expect(listening.assets[0].objectKey).toBeUndefined();
    expect(listening.assets[0].downloadUrl).toBeUndefined();
  });

  it("server-enforces premium: free learners get 403 entitlement_required", async () => {
    const unit = await request(app.getHttpServer())
      .get(`/v1/curriculum/units/${premiumUnitId}`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner");
    expect(unit.status).toBe(403);
    expect(isProblemDetails(unit.body)).toBe(true);
    expect(unit.body.code).toBe("entitlement_required");

    const lesson = await request(app.getHttpServer())
      .get(`/v1/curriculum/lessons/${premiumLessonId}`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner");
    expect(lesson.status).toBe(403);
    expect(lesson.body.code).toBe("entitlement_required");
    expect(lesson.body.activities).toBeUndefined();
  });

  it("hides unpublished version IDs (404)", async () => {
    const ghost = createUuidV7();
    const unit = await request(app.getHttpServer())
      .get(`/v1/curriculum/units/${ghost}`)
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner");
    expect(unit.status).toBe(404);
    expect(isProblemDetails(unit.body)).toBe(true);
  });
});
