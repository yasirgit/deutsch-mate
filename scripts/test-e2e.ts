/**
 * Root API e2e test runner (browser harness deferred where noted in TASKS).
 *
 * Usage:
 *   pnpm test:e2e --filter first-session
 *   pnpm test:e2e --filter consent
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

const selected = filters.length > 0 ? filters : ["first-session"];

/** API-level e2e suites (browser e2e deferred until client harness exists). */
const e2eSuites: Record<string, string> = {
  "first-session": "src/modules/learner/first-session.e2e.test.ts",
  /** Alias: consent browser e2e deferred; API flow lives in consent integration. */
  consent: "src/modules/identity/consent.integration.test.ts",
};

for (const name of selected) {
  const file = e2eSuites[name];
  if (!file) {
    console.error(`Unknown e2e filter: ${name}`);
    process.exit(1);
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

process.exit(0);
