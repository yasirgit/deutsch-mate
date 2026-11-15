/**
 * First-session API e2e (DM-037): locale → consents → profile → resume → first unit.
 * Browser harness is deferred; this is the cross-device first-session path at the API.
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
import { seedLegalDocumentVersion } from "../identity/seed-legal-documents.js";
import { StubTokenVerifier } from "../identity/testing/oidc-test-keys.js";
import { firstSessionClientFixture } from "./client-fixtures.js";
import { createLearnerApp } from "./testing/create-learner-app.test.js";

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
    INSERT INTO iam.users (id, primary_email, pseudonym_key, status)
    VALUES (${id}::uuid, ${`${id}@first-session.test`}, ${createUuidV7()}::uuid, 'active')
  `.execute(db);
  for (const role of roles) {
    await sql`
      INSERT INTO iam.user_roles (id, user_id, role, reason)
      VALUES (${createUuidV7()}::uuid, ${id}::uuid, ${role}::iam.role_code, 'dm-037 e2e')
    `.execute(db);
  }
  return id;
}

describe("first-session e2e", () => {
  let app: INestApplication;
  let disposeDb: () => Promise<void>;
  let db: Kysely<Database>;
  let learnerId: string;
  let freeUnitId: string;
  let termsId: string;
  let privacyId: string;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    const harness = await createMigratedTestDatabase("deutsch_mate_dm037_first_session");
    disposeDb = harness.dispose;
    db = harness.db;
    const connectionString = harness.connectionString;
    process.env["DATABASE_URL"] = connectionString;
    process.env["REDIS_URL"] ??= "redis://localhost:63799";

    const editorId = await seedUser(db, ["content_editor"]);
    const submitterId = await seedUser(db, ["content_reviewer"]);
    const reviewerId = await seedUser(db, ["content_reviewer"]);
    learnerId = await seedUser(db, ["learner"]);

    termsId = await seedLegalDocumentVersion(db, {
      createdByUserId: learnerId,
      documentCode: "terms",
    });
    privacyId = await seedLegalDocumentVersion(db, {
      createdByUserId: learnerId,
      documentCode: "privacy",
    });

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

    app = await createLearnerApp({
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
        description: "DM-037 first-session.",
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

    const freeUnit = await sql<{ id: string }>`
      SELECT id FROM content.unit_versions WHERE unit_key = 'unit.a1.smoke.u1' LIMIT 1
    `.execute(db);
    freeUnitId = freeUnit.rows[0]!.id;
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await disposeDb();
  });

  it("reaches the first published free unit after interrupted onboarding", async () => {
    const me = await request(app.getHttpServer())
      .get("/v1/me")
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(200);

    await request(app.getHttpServer())
      .patch("/v1/me")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .set("If-Match", me.headers["etag"] as string)
      .set("Content-Type", "application/merge-patch+json")
      .send(firstSessionClientFixture.localePatch)
      .expect(200);

    await request(app.getHttpServer())
      .post("/v1/me/consents")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .send({
        events: [
          {
            purposeCode: "terms",
            decision: "granted",
            source: "ios",
            documentVersionId: termsId,
          },
          {
            purposeCode: "privacy",
            decision: "granted",
            source: "ios",
            documentVersionId: privacyId,
          },
          // marketing skipped — optional
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .put("/v1/me/profile")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .set("If-Match", `"1"`)
      .send(firstSessionClientFixture.profileInput)
      .expect(201);

    // Device A advances to level, then "disconnects".
    const afterGoal = await request(app.getHttpServer())
      .patch("/v1/me/onboarding")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .set(
        "If-Match",
        (
          await request(app.getHttpServer())
            .get("/v1/me/onboarding")
            .set(TEST_ACTOR_HEADER, learnerId)
            .expect(200)
        ).headers["etag"] as string,
      )
      .set("Content-Type", "application/merge-patch+json")
      .send({ stepCode: "level", completedSteps: ["legal", "goal"] })
      .expect(200);
    expect(afterGoal.body.stepCode).toBe("level");

    // Device B resumes from durable state.
    const resumed = await request(app.getHttpServer())
      .get("/v1/me/onboarding")
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(200);
    expect(resumed.body.stepCode).toBe("level");
    expect(resumed.body.completedSteps).toEqual(["legal", "goal"]);

    await request(app.getHttpServer())
      .patch("/v1/me/onboarding")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .set("If-Match", resumed.headers["etag"] as string)
      .set("Content-Type", "application/merge-patch+json")
      .send({
        stepCode: "ready",
        completedSteps: ["legal", "goal", "level", "cadence"],
      })
      .expect(200);

    const done = await request(app.getHttpServer())
      .post("/v1/me/onboarding/complete")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", createUuidV7())
      .expect(200);

    expect(done.body.recommendedUnit.id).toBe(freeUnitId);
    expect(done.body.onboarding.recommendedUnitVersionId).toBe(freeUnitId);

    const account = await request(app.getHttpServer())
      .get("/v1/me")
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(200);
    expect(account.body.interfaceLocale).toBe("de");

    const profile = await request(app.getHttpServer())
      .get("/v1/me/profile")
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(200);
    expect(profile.body.selectedLevel).toBe("A1");
    expect(profile.body).not.toHaveProperty("interfaceLocale");
  });
});
