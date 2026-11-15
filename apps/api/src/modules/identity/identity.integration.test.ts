/**
 * Identity integration tests (DM-035): OIDC provision, GET/PATCH /me,
 * age gate, initiateDeletion, optimistic concurrency + idempotent replay.
 */

import "reflect-metadata";

import path from "node:path";

import { isProblemDetails } from "@deutsch-mate/api-schemas";
import { applyMigrations, createKysely, createPgPool, type Database } from "@deutsch-mate/database";
import { createUuidV7 } from "@deutsch-mate/domain";
import type { INestApplication } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import { sql, type Kysely } from "kysely";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TEST_ACTOR_HEADER } from "../../platform/auth/auth.guard.js";
import { IdentityService } from "./identity.service.js";
import { createIdentityApp } from "./testing/create-identity-app.test.js";
import { StubTokenVerifier } from "./testing/oidc-test-keys.js";

const repoMigrations = path.resolve(process.cwd(), "../../migrations");
const ISSUER = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_dm035";

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

describe("identity integration", () => {
  let app: INestApplication;
  let disposeDb: () => Promise<void>;
  let db: Kysely<Database>;
  let identity: IdentityService;
  const bearerToken = `test-access-${createUuidV7()}`;
  const oidcSubject = `sub-${createUuidV7()}`;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    const harness = await createMigratedTestDatabase("deutsch_mate_dm035_identity");
    disposeDb = harness.dispose;
    db = harness.db;
    process.env["DATABASE_URL"] = harness.connectionString;
    process.env["REDIS_URL"] ??= "redis://localhost:63799";

    app = await createIdentityApp({
      tokenVerifier: StubTokenVerifier.fromClaims(bearerToken, {
        issuer: ISSUER,
        subject: oidcSubject,
        email: "learner@example.test",
        emailVerified: true,
      }),
    });
    identity = app.get(IdentityService);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await disposeDb();
  });

  it("provisions on first Bearer login and returns GET /me with age fields + ETag", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/me")
      .set("Authorization", `Bearer ${bearerToken}`)
      .expect(200);

    expect(typeof res.body.id).toBe("string");
    expect(res.body.status).toBe("active");
    expect(res.body.primaryEmail).toBe("learner@example.test");
    expect(res.body.interfaceLocale).toBe("en");
    expect(res.body.roles).toContain("learner");
    expect(res.body.birthYear).toBeNull();
    expect(res.body.ageGateConfirmedAt).toBeNull();
    expect(res.headers.etag).toBe('"1"');

    const identities = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM iam.user_identities
      WHERE issuer = ${ISSUER} AND subject = ${oidcSubject}
    `.execute(db);
    expect(identities.rows[0]?.n).toBe(1);
  });

  it("PATCHes interfaceLocale with If-Match and idempotent replay", async () => {
    const me = await request(app.getHttpServer())
      .get("/v1/me")
      .set("Authorization", `Bearer ${bearerToken}`)
      .expect(200);

    const key = `me-locale-${createUuidV7()}`;
    const first = await request(app.getHttpServer())
      .patch("/v1/me")
      .set("Authorization", `Bearer ${bearerToken}`)
      .set("Content-Type", "application/merge-patch+json")
      .set("Idempotency-Key", key)
      .set("If-Match", me.headers.etag as string)
      .send({ interfaceLocale: "de" })
      .expect(200);

    expect(first.body.interfaceLocale).toBe("de");
    expect(first.headers.etag).toBe('"2"');

    const replay = await request(app.getHttpServer())
      .patch("/v1/me")
      .set("Authorization", `Bearer ${bearerToken}`)
      .set("Content-Type", "application/merge-patch+json")
      .set("Idempotency-Key", key)
      .set("If-Match", me.headers.etag as string)
      .send({ interfaceLocale: "de" })
      .expect(200);

    expect(replay.body.interfaceLocale).toBe("de");
    expect(replay.body.id).toBe(first.body.id);

    const conflict = await request(app.getHttpServer())
      .patch("/v1/me")
      .set("Authorization", `Bearer ${bearerToken}`)
      .set("Content-Type", "application/merge-patch+json")
      .set("Idempotency-Key", key)
      .set("If-Match", me.headers.etag as string)
      .send({ interfaceLocale: "fr" })
      .expect(409);

    expect(isProblemDetails(conflict.body)).toBe(true);
    expect(conflict.body.code).toBe("idempotency_conflict");
  });

  it("confirms adult age gate and rejects underage", async () => {
    const me = await request(app.getHttpServer())
      .get("/v1/me")
      .set("Authorization", `Bearer ${bearerToken}`)
      .expect(200);

    const userId = me.body.id as string;
    const adultYear = new Date().getUTCFullYear() - 25;
    const confirmed = await identity.confirmAgeGate(userId, adultYear);
    expect(confirmed.birthYear).toBe(adultYear);
    expect(confirmed.ageGateConfirmedAt).toBeTruthy();

    try {
      await identity.confirmAgeGate(userId, new Date().getUTCFullYear() - 10);
      expect.unreachable("underage confirm should reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: "age_gate_rejected",
      });
    }
  });

  it("initiateDeletion sets deletion_pending and then denies product access", async () => {
    const me = await request(app.getHttpServer())
      .get("/v1/me")
      .set("Authorization", `Bearer ${bearerToken}`)
      .expect(200);
    const userId = me.body.id as string;

    const pending = await identity.initiateDeletion(userId);
    expect(pending.status).toBe("deletion_pending");

    const denied = await request(app.getHttpServer())
      .get("/v1/me")
      .set("Authorization", `Bearer ${bearerToken}`)
      .expect(403);

    expect(isProblemDetails(denied.body)).toBe(true);
    expect(denied.body.code).toBe("account_access_denied");
  });

  it("still supports X-DM-Test-Actor for seeded users", async () => {
    const seeded = createUuidV7();
    await sql`
      INSERT INTO iam.users (id, primary_email, pseudonym_key)
      VALUES (
        ${seeded}::uuid,
        ${`seed-${seeded.slice(0, 8)}@example.test`},
        ${createUuidV7()}::uuid
      )
    `.execute(db);
    await sql`
      INSERT INTO iam.user_roles (id, user_id, role, reason)
      VALUES (${createUuidV7()}::uuid, ${seeded}::uuid, 'learner', 'identity integration seed')
    `.execute(db);

    const res = await request(app.getHttpServer())
      .get("/v1/me")
      .set(TEST_ACTOR_HEADER, seeded)
      .expect(200);

    expect(res.body.id).toBe(seeded);
    expect(res.body.status).toBe("active");
  });
});
