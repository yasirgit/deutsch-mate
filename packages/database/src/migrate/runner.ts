import type pg from "pg";

import {
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  formatPgTimeout,
  type MigrationTimeouts,
} from "../timeouts.js";
import { discoverMigrationFiles, type DiscoveredMigration } from "./discover.js";
import { enableLocalRoleLogins, MIGRATOR_ROLE } from "./roles.js";

export interface MigrationActorContext {
  readonly actor: string;
  readonly deployedCommit: string | null;
}

export interface ApplyMigrationsOptions {
  readonly migrationsDir: string;
  readonly client: pg.PoolClient | pg.Client;
  readonly timeouts?: Partial<MigrationTimeouts>;
  readonly actorContext?: Partial<MigrationActorContext>;
  /** When set (and not production), enable LOGIN on runtime roles with this password. */
  readonly localRolePassword?: string | null;
}

export interface ApplyMigrationsResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

interface LedgerRow {
  readonly name: string;
  readonly sha256: string;
}

function resolveActorContext(partial?: Partial<MigrationActorContext>): MigrationActorContext {
  const actor =
    partial?.actor ??
    process.env["MIGRATION_ACTOR"] ??
    process.env["USER"] ??
    process.env["USERNAME"] ??
    "unknown";
  const deployedCommit =
    partial?.deployedCommit !== undefined
      ? partial.deployedCommit
      : (process.env["GIT_COMMIT"] ?? process.env["GITHUB_SHA"] ?? null);
  return { actor, deployedCommit };
}

function resolveTimeouts(partial?: Partial<MigrationTimeouts>): MigrationTimeouts {
  return {
    lockTimeoutMs: partial?.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
    statementTimeoutMs: partial?.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
  };
}

async function ledgerExists(client: pg.PoolClient | pg.Client): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'ops' AND table_name = 'schema_migrations'
     ) AS exists`,
  );
  return rows[0]?.exists === true;
}

async function readLedger(client: pg.PoolClient | pg.Client): Promise<Map<string, string>> {
  if (!(await ledgerExists(client))) {
    return new Map();
  }
  const { rows } = await client.query<LedgerRow>(
    `SELECT name, sha256 FROM ops.schema_migrations ORDER BY name`,
  );
  return new Map(rows.map((row) => [row.name, row.sha256]));
}

async function assertNoChecksumDrift(
  applied: Map<string, string>,
  discovered: readonly DiscoveredMigration[],
): Promise<void> {
  for (const migration of discovered) {
    const recorded = applied.get(migration.name);
    if (recorded !== undefined && recorded !== migration.sha256) {
      throw new Error(
        `Checksum mismatch for migration "${migration.name}": ledger has ${recorded}, file has ${migration.sha256}. Forward-only migrations must not change after apply.`,
      );
    }
  }
  for (const name of applied.keys()) {
    if (!discovered.some((migration) => migration.name === name)) {
      throw new Error(
        `Ledger contains migration "${name}" that is missing from the migrations directory.`,
      );
    }
  }
}

/**
 * Applies pending forward-only SQL migrations.
 *
 * Each migration runs in its own transaction with `SET LOCAL lock_timeout` and
 * `SET LOCAL statement_timeout`. After `0001` creates `dm_migrator`, later
 * migrations execute under `SET LOCAL ROLE dm_migrator`.
 */
export async function applyMigrations(
  options: ApplyMigrationsOptions,
): Promise<ApplyMigrationsResult> {
  const { client, migrationsDir } = options;
  const timeouts = resolveTimeouts(options.timeouts);
  const actorContext = resolveActorContext(options.actorContext);
  const discovered = await discoverMigrationFiles(migrationsDir);
  const appliedLedger = await readLedger(client);
  await assertNoChecksumDrift(appliedLedger, discovered);

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of discovered) {
    if (appliedLedger.has(migration.name)) {
      skipped.push(migration.name);
      continue;
    }

    const useMigrator = await ledgerExists(client);
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL lock_timeout = '${formatPgTimeout(timeouts.lockTimeoutMs)}'`);
      await client.query(
        `SET LOCAL statement_timeout = '${formatPgTimeout(timeouts.statementTimeoutMs)}'`,
      );
      // Bootstrap 0001 runs as the session owner. After the ledger exists,
      // subsequent migrations execute under dm_migrator (roles are cluster-global).
      if (useMigrator) {
        await client.query(`SET LOCAL ROLE ${MIGRATOR_ROLE}`);
      }
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO ops.schema_migrations (name, sha256, deployed_commit, actor)
         VALUES ($1, $2, $3, $4)`,
        [migration.name, migration.sha256, actorContext.deployedCommit, actorContext.actor],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    applied.push(migration.name);
    appliedLedger.set(migration.name, migration.sha256);
  }

  if (options.localRolePassword !== undefined && options.localRolePassword !== null) {
    await enableLocalRoleLogins(client, options.localRolePassword);
  }

  return { applied, skipped };
}
