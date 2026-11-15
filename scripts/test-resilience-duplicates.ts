/**
 * Duplicate-delivery resilience suite (DM-023 + DM-038 verify).
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databasePackage = path.join(root, "packages", "database");

const dbResult = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "--config", "vitest.config.ts", "src/ops/duplicates.resilience.test.ts"],
  {
    cwd: databasePackage,
    stdio: "inherit",
    env: process.env,
  },
);
if ((dbResult.status ?? 1) !== 0) {
  process.exit(dbResult.status ?? 1);
}

const apiResult = spawnSync(
  "pnpm",
  [
    "--filter",
    "@deutsch-mate/api",
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.config.ts",
    "src/modules/learning/learning-duplicates.resilience.test.ts",
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  },
);

process.exit(apiResult.status ?? 1);
