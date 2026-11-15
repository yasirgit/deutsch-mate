/**
 * Root integration test runner.
 *
 * Usage:
 *   pnpm test:integration --filter idempotency --filter messaging --filter audit
 *   pnpm test:integration --filter api-platform
 *   pnpm test:integration --filter identity
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

const databaseFilters = new Set(["idempotency", "messaging", "audit"]);
const apiIntegrationSuites: Record<string, string> = {
  "api-platform": "src/platform/platform.integration.test.ts",
  identity: "src/modules/identity/identity.integration.test.ts",
  consent: "src/modules/identity/consent.integration.test.ts",
  "content-publication": "src/modules/content/content.integration.test.ts",
  curriculum: "src/modules/content/curriculum.integration.test.ts",
  learner: "src/modules/learner/learner.integration.test.ts",
  "deterministic-scoring": "src/modules/learning/deterministic-scoring.integration.test.ts",
  review: "src/modules/learning/review.integration.test.ts",
};

const selected =
  filters.length > 0
    ? filters
    : ["idempotency", "messaging", "audit", "api-platform"];

const dbFiles = selected
  .filter((name) => databaseFilters.has(name))
  .map((name) => `src/ops/${name}.integration.test.ts`);

if (dbFiles.length > 0) {
  const result = spawnSync(
    "pnpm",
    ["exec", "vitest", "run", "--config", "vitest.config.ts", ...dbFiles],
    {
      cwd: databasePackage,
      stdio: "inherit",
      env: process.env,
    },
  );
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

for (const name of selected) {
  const file = apiIntegrationSuites[name];
  if (!file) {
    continue;
  }
  const result = spawnSync(
    "pnpm",
    ["--filter", "@deutsch-mate/api", "exec", "vitest", "run", "--config", "vitest.config.ts", file],
    {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    },
  );
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

const unknown = selected.filter(
  (name) => !databaseFilters.has(name) && !(name in apiIntegrationSuites),
);
if (unknown.length > 0) {
  console.error(`Unknown integration filter(s): ${unknown.join(", ")}`);
  process.exit(1);
}

process.exit(0);
