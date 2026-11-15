/**
 * Root resilience test runner.
 *
 * Usage:
 *   pnpm test:resilience --filter ai-outage
 *   pnpm test:resilience --filter duplicates
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databasePackage = path.join(root, "packages", "database");

const filters: string[] = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--" || arg === undefined) {
    continue;
  }
  if (arg === "--filter" && argv[i + 1]) {
    filters.push(argv[i + 1]!);
    i += 1;
  } else if (arg.startsWith("--filter=")) {
    filters.push(arg.slice("--filter=".length));
  }
}

const selected = filters.length > 0 ? filters : ["duplicates"];

const databaseSuites: Record<string, string> = {
  duplicates: "src/ops/duplicates.resilience.test.ts",
};

const apiSuites: Record<string, string> = {
  "ai-outage": "src/modules/content/curriculum.ai-outage.resilience.test.ts",
  "learning-duplicates": "src/modules/learning/learning-duplicates.resilience.test.ts",
};

for (const name of selected) {
  const dbFile = databaseSuites[name];
  if (dbFile) {
    const result = spawnSync(
      "pnpm",
      ["exec", "vitest", "run", "--config", "vitest.config.ts", dbFile],
      {
        cwd: databasePackage,
        stdio: "inherit",
        env: process.env,
      },
    );
    if ((result.status ?? 1) !== 0) {
      process.exit(result.status ?? 1);
    }
    continue;
  }

  const apiFile = apiSuites[name];
  if (apiFile) {
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
        apiFile,
      ],
      {
        cwd: root,
        stdio: "inherit",
        env: process.env,
      },
    );
    if ((result.status ?? 1) !== 0) {
      process.exit(result.status ?? 1);
    }
    continue;
  }

  console.error(`Unknown resilience filter: ${name}`);
  process.exit(1);
}

process.exit(0);
