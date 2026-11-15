/**
 * Regenerates Kysely types from the live PostgreSQL schema into
 * `packages/database/src/generated/database.ts`.
 *
 * Requires a migrated database (`pnpm db:migrate` / `pnpm db:reset`).
 * Patches Int8 select type to native `bigint` (docs/Database.md §2.1).
 * Codegen emits `DB`; the package re-exports it as `Database`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { loadLocalEnv, repoRoot } from "./lib/env.ts";

const databasePackage = path.join(repoRoot, "packages", "database");
const outFile = path.join(databasePackage, "src", "generated", "database.ts");
const schemas = [
  "iam",
  "learner",
  "media",
  "content",
  "learning",
  "ai",
  "billing",
  "privacy",
  "support",
  "ops",
] as const;

const env = loadLocalEnv();
const args = [
  "exec",
  "kysely-codegen",
  "--dialect",
  "postgres",
  "--numeric-parser",
  "string",
  "--include-pattern",
  `{${schemas.join(",")}}.*`,
  "--exclude-pattern",
  "ops.schema_migrations",
  ...schemas.flatMap((schema) => ["--default-schema", schema]),
  "--out-file",
  outFile,
  "--type-only-imports",
  "--url",
  env.databaseUrl,
];

console.log("[db:codegen] Introspecting database and generating types...");
const result = spawnSync("pnpm", args, {
  cwd: databasePackage,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: env.databaseUrl },
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const generated = readFileSync(outFile, "utf8");
const patched = generated.replace(
  "export type Int8 = ColumnType<string, bigint | number | string, bigint | number | string>;",
  "export type Int8 = ColumnType<bigint, bigint | number | string, bigint | number | string>;",
);
if (patched === generated) {
  console.warn(
    "[db:codegen] Warning: Int8 select-type patch did not apply; check kysely-codegen output.",
  );
} else {
  writeFileSync(outFile, patched);
  console.log("[db:codegen] Patched Int8 select type to native bigint.");
}

console.log(`[db:codegen] Wrote ${path.relative(repoRoot, outFile)}`);
