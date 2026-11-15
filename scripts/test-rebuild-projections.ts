/**
 * Rebuildable review projection verification (DM-039).
 *
 * Usage:
 *   pnpm test:rebuild-projections
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = spawnSync(
  "pnpm",
  [
    "--filter",
    "@deutsch-mate/api",
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.config.ts",
    "src/modules/learning/review.integration.test.ts",
    "-t",
    "rebuilds review_items",
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  },
);

process.exit(result.status ?? 1);
