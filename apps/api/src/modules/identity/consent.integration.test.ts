/**
 * Consent integration / API-level e2e-style flow (DM-036).
 * Browser harness e2e is deferred; this covers requirements → record → list → withdraw.
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

import { TEST_ACTOR_HEADER } from "../../platform/auth/auth.guard.js";
import { createIdentityApp } from "./testing/create-identity-app.test.js";
import { seedLegalDocumentVersion } from "./seed-legal-documents.js";

const repoMigrations = path.resolve(process.cwd(), "../../migrations");

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

describe("consent integration", () => {
  let app: INestApplication;
  let disposeDb: () => Promise<void>;
  let db: Kysely<Database>;
  let userId: string;
  let termsId: string;
  let privacyId: string;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    const harness = await createMigratedTestDatabase("deutsch_mate_dm036_consent");
    disposeDb = harness.dispose;
    db = harness.db;
    process.env["DATABASE_URL"] = harness.connectionString;
    process.env["REDIS_URL"] ??= "redis://localhost:63799";

    userId = createUuidV7();
    await sql`
      INSERT INTO iam.users (id, primary_email, pseudonym_key)
      VALUES (${userId}::uuid, ${`${userId}@example.test`}, ${createUuidV7()}::uuid)
    `.execute(db);
    await sql`
      INSERT INTO iam.user_roles (id, user_id, role, reason)
      VALUES (${createUuidV7()}::uuid, ${userId}::uuid, 'learner', 'consent seed')
    `.execute(db);

    termsId = await seedLegalDocumentVersion(db, {
      createdByUserId: userId,
      documentCode: "terms",
    });
    privacyId = await seedLegalDocumentVersion(db, {
      createdByUserId: userId,
      documentCode: "privacy",
    });

    app = await createIdentityApp();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await disposeDb();
  });

  it("returns required documents and optional marketing purpose", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/me/consents/requirements")
      .set(TEST_ACTOR_HEADER, userId)
      .expect(200);

    expect(res.body.purposes).toEqual(["marketing"]);
    const codes = (res.body.documents as { documentCode: string; id: string }[]).map(
      (d) => d.documentCode,
    );
    expect(codes).toContain("terms");
    expect(codes).toContain("privacy");
    expect(res.body.documents.some((d: { id: string }) => d.id === termsId)).toBe(true);
    expect(res.body.documents.some((d: { id: string }) => d.id === privacyId)).toBe(true);
  });

  it("records unbundled terms/privacy/marketing and lists latest per purpose", async () => {
    const key = `consent-${createUuidV7()}`;
    const created = await request(app.getHttpServer())
      .post("/v1/me/consents")
      .set(TEST_ACTOR_HEADER, userId)
      .set("Idempotency-Key", key)
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
          {
            purposeCode: "marketing",
            decision: "granted",
            source: "web",
          },
        ],
      })
      .expect(201);

    expect(created.body.items).toHaveLength(3);

    const list = await request(app.getHttpServer())
      .get("/v1/me/consents")
      .set(TEST_ACTOR_HEADER, userId)
      .expect(200);

    expect(list.body.items).toHaveLength(3);
    const marketing = list.body.items.find(
      (i: { purposeCode: string }) => i.purposeCode === "marketing",
    );
    expect(marketing.decision).toBe("granted");
    expect(marketing.documentVersionId).toBeUndefined();
  });

  it("rejects terms without documentVersionId and marketing with documentVersionId", async () => {
    const missing = await request(app.getHttpServer())
      .post("/v1/me/consents")
      .set(TEST_ACTOR_HEADER, userId)
      .set("Idempotency-Key", `c-${createUuidV7()}`)
      .send({
        events: [{ purposeCode: "terms", decision: "granted", source: "ios" }],
      })
      .expect(400);
    expect(isProblemDetails(missing.body)).toBe(true);

    const extra = await request(app.getHttpServer())
      .post("/v1/me/consents")
      .set(TEST_ACTOR_HEADER, userId)
      .set("Idempotency-Key", `c-${createUuidV7()}`)
      .send({
        events: [
          {
            purposeCode: "marketing",
            decision: "granted",
            source: "ios",
            documentVersionId: termsId,
          },
        ],
      })
      .expect(400);
    expect(isProblemDetails(extra.body)).toBe(true);
  });

  it("allows withdrawing marketing without affecting prior terms grant", async () => {
    await request(app.getHttpServer())
      .post("/v1/me/consents")
      .set(TEST_ACTOR_HEADER, userId)
      .set("Idempotency-Key", `c-${createUuidV7()}`)
      .send({
        events: [{ purposeCode: "marketing", decision: "withdrawn", source: "web" }],
      })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get("/v1/me/consents")
      .set(TEST_ACTOR_HEADER, userId)
      .expect(200);

    const byPurpose = Object.fromEntries(
      (list.body.items as { purposeCode: string; decision: string }[]).map((i) => [
        i.purposeCode,
        i.decision,
      ]),
    );
    expect(byPurpose["marketing"]).toBe("withdrawn");
    expect(byPurpose["terms"]).toBe("granted");
    expect(byPurpose["privacy"]).toBe("granted");
  });
});
