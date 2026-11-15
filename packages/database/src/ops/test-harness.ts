/**
 * Shared Postgres harness for DM-023 ops integration tests.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createUuidV7 } from "@deutsch-mate/domain";
import { sql, type Kysely, type Transaction } from "kysely";
import pg from "pg";

import {
  applyMigrations,
  createKysely,
  createPgPool,
  type Database,
} from "../index.js";

const repoMigrations = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../migrations",
);

export function adminConnectionConfig(): {
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

export async function createMigratedTestDatabase(dbName: string): Promise<{
  pool: pg.Pool;
  db: Kysely<Database>;
  rolePassword: string;
  dispose: () => Promise<void>;
}> {
  const adminConfig = adminConnectionConfig();
  const rolePassword = adminConfig.password;
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
      localRolePassword: rolePassword,
    });
  } finally {
    await migrator.end();
  }

  const pool = createPgPool({ ...adminConfig, database: dbName, max: 4 });
  const db = createKysely({ pool });

  return {
    pool,
    db,
    rolePassword,
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

export async function seedLearnerUser(
  db: Kysely<Database>,
  userId: string = createUuidV7(),
): Promise<string> {
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
    VALUES (${createUuidV7()}::uuid, ${userId}::uuid, 'learner', 'test seed')
  `.execute(db);
  return userId;
}

export async function withApiRole<T>(
  db: Kysely<Database>,
  context: { userId: string; correlationId: string; roles?: readonly string[] },
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  const roles = (context.roles ?? ["learner"]).join(",");
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL ROLE dm_api`.execute(trx);
    await sql`SELECT set_config('app.user_id', ${context.userId}, true)`.execute(trx);
    await sql`SELECT set_config('app.roles', ${roles}, true)`.execute(trx);
    await sql`SELECT set_config('app.correlation_id', ${context.correlationId}, true)`.execute(
      trx,
    );
    return fn(trx);
  });
}

export async function withWorkerRole<T>(
  db: Kysely<Database>,
  role: "dm_outbox_worker" | "dm_ai_worker",
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL ROLE ${sql.raw(role)}`.execute(trx);
    return fn(trx);
  });
}

export { createUuidV7 };
