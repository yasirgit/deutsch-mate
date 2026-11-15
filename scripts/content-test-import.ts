#!/usr/bin/env node
/**
 * End-to-end smoke: validate + manifest + draft import against local Postgres.
 * Prefers an already-migrated DATABASE_URL; run `pnpm db:migrate` first if needed.
 *
 * Usage: pnpm content:test-import
 */
import path from "node:path";

import { importRelease, validateRelease } from "@deutsch-mate/content-pipeline";
import pg from "pg";

import { loadLocalEnv, repoRoot } from "./lib/env.ts";

const dir = path.join(repoRoot, "content/fixtures/import-smoke");
const env = loadLocalEnv();

const validated = validateRelease({ dir, writeManifestFile: true });
if (!validated.inventory.ok) {
  console.error("content:test-import FAILED — inventory");
  for (const issue of validated.inventory.issues) {
    console.error(`  [${issue.code}] ${issue.path}: ${issue.message}`);
  }
  process.exit(1);
}

const first = await importRelease({
  connectionString: env.databaseUrl,
  loaded: validated.loaded,
});
const second = await importRelease({
  connectionString: env.databaseUrl,
  loaded: validated.loaded,
});

const client = new pg.Client({ connectionString: env.databaseUrl });
await client.connect();
try {
  const { rows } = await client.query<{
    status: string;
    unit_count: string;
  }>(
    `SELECT r.status::text AS status,
            (SELECT count(*)::text FROM content.module_units mu
             JOIN content.release_modules rm ON rm.module_version_id = mu.module_version_id
             WHERE rm.release_id = r.id) AS unit_count
     FROM content.curriculum_releases r
     WHERE r.release_key = $1 AND r.version = $2`,
    [first.releaseKey, first.releaseVersion],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error("Release row missing after import");
  }
  if (row.status !== "draft") {
    throw new Error(`Expected draft status, got ${row.status}`);
  }
  if (row.unit_count !== "6") {
    throw new Error(`Expected 6 units in release membership, got ${row.unit_count}`);
  }
} finally {
  await client.end();
}

console.log("content:test-import OK");
console.log(`  first inserted activities=${first.inserted.activities}`);
console.log(`  second skippedExisting=${second.skippedExisting} (idempotent)`);
console.log(`  status=draft unit_count=6 manifestSha256=${first.manifestSha256}`);
