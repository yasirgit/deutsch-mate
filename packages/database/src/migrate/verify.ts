import type pg from "pg";

import { discoverMigrationFiles } from "./discover.js";

export interface VerifyMigrationsResult {
  readonly ok: true;
  readonly migrations: readonly {
    readonly name: string;
    readonly sha256: string;
    readonly appliedAt: Date;
  }[];
}

/**
 * Verifies that every migration file is recorded in `ops.schema_migrations`
 * with a matching SHA-256, and that the ledger has no unexpected rows.
 */
export async function verifyMigrations(
  client: pg.PoolClient | pg.Client,
  migrationsDir: string,
): Promise<VerifyMigrationsResult> {
  const discovered = await discoverMigrationFiles(migrationsDir);
  const { rows } = await client.query<{
    name: string;
    sha256: string;
    applied_at: Date;
  }>(`SELECT name, sha256, applied_at FROM ops.schema_migrations ORDER BY name`);

  const ledger = new Map(rows.map((row) => [row.name, row]));

  if (rows.length !== discovered.length) {
    throw new Error(
      `Migration ledger count mismatch: ledger has ${String(rows.length)}, files have ${String(discovered.length)}.`,
    );
  }

  for (const migration of discovered) {
    const recorded = ledger.get(migration.name);
    if (recorded === undefined) {
      throw new Error(
        `Migration "${migration.name}" is present on disk but missing from the ledger.`,
      );
    }
    if (recorded.sha256 !== migration.sha256) {
      throw new Error(
        `Checksum mismatch for "${migration.name}": ledger ${recorded.sha256}, file ${migration.sha256}.`,
      );
    }
  }

  for (const name of ledger.keys()) {
    if (!discovered.some((migration) => migration.name === name)) {
      throw new Error(`Ledger contains unknown migration "${name}".`);
    }
  }

  return {
    ok: true,
    migrations: rows.map((row) => ({
      name: row.name,
      sha256: row.sha256,
      appliedAt: row.applied_at,
    })),
  };
}
