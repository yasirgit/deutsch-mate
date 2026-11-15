/**
 * Learner integration tests (DM-037): versioned profiles, resumable onboarding,
 * locale/preference separation, published first-unit recommendation.
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
import { seedLegalDocumentVersion } from "../identity/seed-legal-documents.js";
import { StubTokenVerifier } from "../identity/testing/oidc-test-keys.js";
import {
  assertLocaleProfileSeparation,
  firstSessionClientFixture,
} from "./client-fixtures.js";
import { SELF_SELECT_ALGORITHM } from "./proficiency.service.js";
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
    INSERT INTO iam.users (id, primary_email, pseudonym_key, status, interface_locale)
    VALUES (
      ${id}::uuid,
      ${`${id}@learner.test`},
      ${createUuidV7()}::uuid,
      'active',
      'en'
    )
  `.execute(db);
  for (const role of roles) {
    await sql`
      INSERT INTO iam.user_roles (id, user_id, role, reason)
      VALUES (${createUuidV7()}::uuid, ${id}::uuid, ${role}::iam.role_code, 'dm-037 test')
    `.execute(db);
  }
  return id;
}

describe("learner integration", () => {
  let app: INestApplication;
  let disposeDb: () => Promise<void>;
  let db: Kysely<Database>;
  let learnerId: string;
  let editorId: string;
  let submitterId: string;
  let reviewerId: string;
  let termsId: string;
  let privacyId: string;
  let freeUnitId: string;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    const harness = await createMigratedTestDatabase("deutsch_mate_dm037_learner");
    disposeDb = harness.dispose;
    db = harness.db;
    const connectionString = harness.connectionString;
    process.env["DATABASE_URL"] = connectionString;
    process.env["REDIS_URL"] ??= "redis://localhost:63799";

    editorId = await seedUser(db, ["content_editor"]);
    submitterId = await seedUser(db, ["content_reviewer"]);
    reviewerId = await seedUser(db, ["content_reviewer"]);
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
        description: "DM-037 learner fixture.",
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

  it("separates interface locale (PATCH /me) from learner profile preferences", async () => {
    assertLocaleProfileSeparation(
      firstSessionClientFixture.localePatch,
      firstSessionClientFixture.profileInput,
    );

    const me = await request(app.getHttpServer())
      .get("/v1/me")
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(200);
    const etag = me.headers["etag"] as string;

    await request(app.getHttpServer())
      .patch("/v1/me")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", `locale-${createUuidV7()}`)
      .set("If-Match", etag)
      .set("Content-Type", "application/merge-patch+json")
      .send(firstSessionClientFixture.localePatch)
      .expect(200);

    const afterLocale = await request(app.getHttpServer())
      .get("/v1/me")
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(200);
    expect(afterLocale.body.interfaceLocale).toBe("de");

    const missing = await request(app.getHttpServer())
      .get("/v1/me/profile")
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(404);
    expect(isProblemDetails(missing.body)).toBe(true);

    const created = await request(app.getHttpServer())
      .put("/v1/me/profile")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", `profile-${createUuidV7()}`)
      .set("If-Match", `"1"`)
      .send(firstSessionClientFixture.profileInput)
      .expect(201);

    expect(created.body.selectedLevel).toBe("A1");
    expect(created.body.goal).toBe("general");
    expect(created.body.studyMinutesPerDay).toBeNull();
    expect(created.body.studyDaysPerWeek).toBeNull();
    expect(created.body.preferences.skippedSteps).toEqual(["cadence"]);
    expect(created.body).not.toHaveProperty("interfaceLocale");
    expect(created.headers["etag"]).toBe(`"1"`);

    const meAgain = await request(app.getHttpServer())
      .get("/v1/me")
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(200);
    expect(meAgain.body.interfaceLocale).toBe("de");

    const snap = await sql<{ algorithm_version: string; overall_estimate: string | null }>`
      SELECT algorithm_version, overall_estimate::text AS overall_estimate
      FROM learner.proficiency_snapshots
      WHERE user_id = ${learnerId}::uuid
      ORDER BY sequence DESC
      LIMIT 1
    `.execute(db);
    expect(snap.rows[0]?.algorithm_version).toBe(SELF_SELECT_ALGORITHM);
    expect(snap.rows[0]?.overall_estimate).toBeNull();
  });

  it("appends profile versions and resumes onboarding across interruption", async () => {
    const tip = await request(app.getHttpServer())
      .get("/v1/me/profile")
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(200);
    const etag = tip.headers["etag"] as string;

    const v2 = await request(app.getHttpServer())
      .put("/v1/me/profile")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", `profile-v2-${createUuidV7()}`)
      .set("If-Match", etag)
      .send({
        goal: "work",
        selectedLevel: "A1",
        targetLevel: "A2",
        studyMinutesPerDay: 20,
        studyDaysPerWeek: 4,
        preferences: {},
      })
      .expect(201);

    expect(v2.body.version).toBe(2);
    expect(v2.body.supersedesId).toBe(tip.body.id);
    expect(v2.body.goal).toBe("work");

    const versions = await sql<{ version: number }>`
      SELECT version FROM learner.profile_versions
      WHERE user_id = ${learnerId}::uuid
      ORDER BY version
    `.execute(db);
    expect(versions.rows.map((r) => r.version)).toEqual([1, 2]);

    const start = await request(app.getHttpServer())
      .get("/v1/me/onboarding")
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(200);
    expect(start.body.stepCode).toBe("legal");
    expect(start.body.completedAt).toBeNull();
    let onboardingEtag = start.headers["etag"] as string;

    for (const step of firstSessionClientFixture.onboardingSteps) {
      const patched = await request(app.getHttpServer())
        .patch("/v1/me/onboarding")
        .set(TEST_ACTOR_HEADER, learnerId)
        .set("Idempotency-Key", `ob-${createUuidV7()}`)
        .set("If-Match", onboardingEtag)
        .set("Content-Type", "application/merge-patch+json")
        .send(step)
        .expect(200);
      expect(patched.body.stepCode).toBe(step.stepCode);
      expect(patched.body.completedSteps).toEqual([...step.completedSteps]);
      onboardingEtag = patched.headers["etag"] as string;
    }

    const mid = await request(app.getHttpServer())
      .get("/v1/me/onboarding")
      .set(TEST_ACTOR_HEADER, learnerId)
      .expect(200);
    expect(mid.body.stepCode).toBe("ready");
    expect(mid.body.completedSteps).toContain("cadence");
  });

  it("requires consents then completes with published free first unit", async () => {
    const withoutConsent = await request(app.getHttpServer())
      .post("/v1/me/onboarding/complete")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", `complete-fail-${createUuidV7()}`);
    expect(withoutConsent.status).toBe(422);
    expect(isProblemDetails(withoutConsent.body)).toBe(true);

    await request(app.getHttpServer())
      .post("/v1/me/consents")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", `consent-${createUuidV7()}`)
      .send({
        events: [
          {
            purposeCode: "terms",
            decision: "granted",
            source: "web",
            documentVersionId: termsId,
          },
          {
            purposeCode: "privacy",
            decision: "granted",
            source: "web",
            documentVersionId: privacyId,
          },
        ],
      })
      .expect(201);

    const completed = await request(app.getHttpServer())
      .post("/v1/me/onboarding/complete")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", `complete-${createUuidV7()}`)
      .expect(200);

    expect(completed.body.onboarding.completedAt).not.toBeNull();
    expect(completed.body.onboarding.stepCode).toBe("complete");
    expect(completed.body.recommendedUnit.id).toBe(freeUnitId);
    expect(completed.body.recommendedUnit.accessTier).toBe("free");
    expect(completed.body.recommendedUnit.level).toBe("A1");
    expect(completed.body.recommendedUnit.locked).toBe(false);

    const replay = await request(app.getHttpServer())
      .post("/v1/me/onboarding/complete")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set("Idempotency-Key", `complete-replay-${createUuidV7()}`)
      .expect(200);
    expect(replay.body.recommendedUnit.id).toBe(freeUnitId);
  });
});
