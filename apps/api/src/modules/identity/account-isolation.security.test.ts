/**
 * Account isolation security tests (DM-035): actor never from request fields;
 * blocked / deletion_pending lose product access; cross-user id spoof ignored.
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
import { StubTokenVerifier } from "./testing/oidc-test-keys.js";

const repoMigrations = path.resolve(process.cwd(), "../../migrations");
const ISSUER = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_iso";

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
  userId: string,
  status: "active" | "blocked" | "deletion_pending" | "deleted" = "active",
): Promise<void> {
  await sql`
    INSERT INTO iam.users (id, status, primary_email, pseudonym_key)
    VALUES (
      ${userId}::uuid,
      ${status}::iam.account_status,
      ${`${userId}@example.test`},
      ${createUuidV7()}::uuid
    )
  `.execute(db);
  await sql`
    INSERT INTO iam.user_roles (id, user_id, role, reason)
    VALUES (${createUuidV7()}::uuid, ${userId}::uuid, 'learner', 'account-isolation seed')
  `.execute(db);
}

describe("account-isolation security", () => {
  let app: INestApplication;
  let disposeDb: () => Promise<void>;
  let db: Kysely<Database>;
  const userA = createUuidV7();
  const userB = createUuidV7();
  const blockedId = createUuidV7();
  const pendingId = createUuidV7();
  const bearerA = `iso-a-${createUuidV7()}`;
  const subjectA = `sub-a-${createUuidV7()}`;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    const harness = await createMigratedTestDatabase("deutsch_mate_dm035_isolation");
    disposeDb = harness.dispose;
    db = harness.db;
    process.env["DATABASE_URL"] = harness.connectionString;
    process.env["REDIS_URL"] ??= "redis://localhost:63799";

    await seedUser(db, userA);
    await seedUser(db, userB);
    await seedUser(db, blockedId, "blocked");
    await seedUser(db, pendingId, "deletion_pending");

    await sql`
      INSERT INTO iam.user_identities (id, user_id, issuer, subject, email_verified)
      VALUES (
        ${createUuidV7()}::uuid,
        ${userA}::uuid,
        ${ISSUER},
        ${subjectA},
        true
      )
    `.execute(db);

    app = await createIdentityApp({
      tokenVerifier: StubTokenVerifier.fromClaims(bearerA, {
        issuer: ISSUER,
        subject: subjectA,
        email: "a@example.test",
        emailVerified: true,
      }),
    });
  }, 120_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (disposeDb) {
      await disposeDb();
    }
  });

  it("OIDC actor ignores spoofed userId in query/body", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/me")
      .set("Authorization", `Bearer ${bearerA}`)
      .query({ userId: userB })
      .expect(200);

    expect(res.body.id).toBe(userA);
    expect(res.body.id).not.toBe(userB);
  });

  it("test-actor header cannot read another user's row via query spoof", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/me")
      .set(TEST_ACTOR_HEADER, userA)
      .query({ userId: userB })
      .expect(200);

    expect(res.body.id).toBe(userA);
  });

  it("blocked accounts receive 403 account_access_denied", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/me")
      .set(TEST_ACTOR_HEADER, blockedId)
      .expect(403);

    // Test actor bypasses OIDC resolve; IdentityService.getCurrentUser enforces status.
    expect(isProblemDetails(res.body)).toBe(true);
    expect(res.body.code).toBe("account_access_denied");
  });

  it("deletion_pending accounts receive 403 account_access_denied", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/me")
      .set(TEST_ACTOR_HEADER, pendingId)
      .expect(403);

    expect(isProblemDetails(res.body)).toBe(true);
    expect(res.body.code).toBe("account_access_denied");
  });
});
