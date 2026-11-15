import path from "node:path";

import pg from "pg";

import { applyMigrations, verifyMigrations } from "@deutsch-mate/database";

import { loadLocalEnv, repoRoot, type LocalEnv } from "./env.ts";
import { waitForPostgres } from "../wait-for-services.ts";

/** Closed allowlist shape for SQL identifiers; never interpolate anything else. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Drops and recreates an empty local development database with no extensions
 * or schema. Extensions/roles/ledger are owned by migration 0001 (DM-020).
 */
export async function createEmptyDatabase(env: LocalEnv = loadLocalEnv()): Promise<string> {
  const { database } = env.postgres;
  if (!SAFE_IDENTIFIER.test(database)) {
    throw new Error(`Refusing to create database with unsafe name "${database}".`);
  }

  await waitForPostgres({ ...env, postgres: { ...env.postgres, database: "postgres" } }, 15_000);

  const maintenance = new pg.Client({ ...env.postgres, database: "postgres" });
  await maintenance.connect();
  try {
    console.log(`[db:create-empty] Dropping database "${database}" if it exists...`);
    await maintenance.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    console.log(`[db:create-empty] Creating empty database "${database}"...`);
    await maintenance.query(`CREATE DATABASE "${database}"`);
  } finally {
    await maintenance.end();
  }

  return database;
}

/**
 * Applies forward-only SQL migrations under migrations/ (DM-020).
 * Enables local LOGIN passwords for runtime roles from env when not production.
 */
export async function migrateDatabase(env: LocalEnv = loadLocalEnv()): Promise<void> {
  await waitForPostgres(env, 15_000);

  const migrationsDir = path.join(repoRoot, "migrations");
  const localRolePassword =
    process.env["DATABASE_ROLE_PASSWORD"] !== undefined &&
    process.env["DATABASE_ROLE_PASSWORD"] !== ""
      ? process.env["DATABASE_ROLE_PASSWORD"]
      : env.postgres.password;

  const client = new pg.Client(env.postgres);
  await client.connect();
  try {
    const result = await applyMigrations({
      client,
      migrationsDir,
      localRolePassword,
    });
    if (result.applied.length === 0) {
      console.log(
        `[db:migrate] No pending migrations (${String(result.skipped.length)} already applied).`,
      );
    } else {
      console.log(`[db:migrate] Applied: ${result.applied.join(", ")}.`);
      if (result.skipped.length > 0) {
        console.log(`[db:migrate] Skipped (already applied): ${result.skipped.join(", ")}.`);
      }
    }
    console.log(
      "[db:migrate] Local runtime role LOGIN passwords updated from env (non-production).",
    );
  } finally {
    await client.end();
  }
}

/** Verifies ops.schema_migrations against on-disk migration SHA-256 checksums. */
export async function verifyDatabaseMigrations(env: LocalEnv = loadLocalEnv()): Promise<void> {
  await waitForPostgres(env, 15_000);

  const migrationsDir = path.join(repoRoot, "migrations");
  const client = new pg.Client(env.postgres);
  await client.connect();
  try {
    const result = await verifyMigrations(client, migrationsDir);
    console.log(
      `[db:migrations:verify] OK — ${String(result.migrations.length)} migration(s) match the ledger.`,
    );
    for (const migration of result.migrations) {
      console.log(`  - ${migration.name} ${migration.sha256}`);
    }
  } finally {
    await client.end();
  }
}
