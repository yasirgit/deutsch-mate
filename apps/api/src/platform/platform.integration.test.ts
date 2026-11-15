/**
 * Platform integration tests (DM-026): readiness with DB, idempotency
 * replay/conflict, correlation into transaction context.
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

import { TEST_ACTOR_HEADER } from "./auth/auth.guard.js";
import { createPlatformApp } from "./testing/create-platform-app.test.js";

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

async function seedLearnerUser(db: Kysely<Database>, userId: string): Promise<void> {
  const pseudonymKey = createUuidV7();
  await sql`
    INSERT INTO iam.users (id, primary_email, pseudonym_key)
    VALUES (
      ${userId}::uuid,
      ${`user-${userId.slice(0, 8)}@example.test`},
      ${pseudonymKey}::uuid
    )
  `.execute(db);
  await sql`
    INSERT INTO iam.user_roles (id, user_id, role, reason)
    VALUES (${createUuidV7()}::uuid, ${userId}::uuid, 'learner', 'platform probe seed')
  `.execute(db);
}

describe("api-platform integration", () => {
  let app: INestApplication;
  let disposeDb: () => Promise<void>;
  let userId: string;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    const harness = await createMigratedTestDatabase("deutsch_mate_dm026_platform");
    disposeDb = harness.dispose;
    userId = createUuidV7();
    await seedLearnerUser(harness.db, userId);
    process.env["DATABASE_URL"] = harness.connectionString;
    // REDIS_URL not required by PlatformModule; set for env consistency.
    process.env["REDIS_URL"] ??= "redis://localhost:63799";
    app = await createPlatformApp();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await disposeDb();
  });

  it("returns ready when the database is reachable", async () => {
    const res = await request(app.getHttpServer()).get("/v1/health/ready").expect(200);
    expect(res.body.status).toBe("ok");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("propagates request ID as transaction correlation_id", async () => {
    const requestId = createUuidV7();
    const res = await request(app.getHttpServer())
      .post("/v1/platform/probes/correlation")
      .set(TEST_ACTOR_HEADER, userId)
      .set("X-Request-Id", requestId)
      .expect(201);

    expect(res.body.requestId).toBe(requestId);
    expect(res.body.correlationId).toBe(requestId);
  });

  it("replays idempotent commands and conflicts on hash change", async () => {
    const key = `probe-${createUuidV7()}`;

    const first = await request(app.getHttpServer())
      .post("/v1/platform/probes/command")
      .set(TEST_ACTOR_HEADER, userId)
      .set("Idempotency-Key", key)
      .send({ message: "one" })
      .expect(201);

    expect(first.body.message).toBe("one");
    expect(typeof first.body.id).toBe("string");
    const originalId = first.body.id as string;

    const replay = await request(app.getHttpServer())
      .post("/v1/platform/probes/command")
      .set(TEST_ACTOR_HEADER, userId)
      .set("Idempotency-Key", key)
      .send({ message: "one" })
      .expect(201);

    expect(replay.body.id).toBe(originalId);
    expect(replay.body.message).toBe("one");

    const conflict = await request(app.getHttpServer())
      .post("/v1/platform/probes/command")
      .set(TEST_ACTOR_HEADER, userId)
      .set("Idempotency-Key", key)
      .send({ message: "two" })
      .expect(409);

    expect(isProblemDetails(conflict.body)).toBe(true);
    expect(conflict.body.code).toBe("idempotency_conflict");
    expect(conflict.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(conflict.body.requestId).toBe(conflict.headers["x-request-id"]);
  });
});
