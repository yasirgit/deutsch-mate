/**
 * Root contract test runner.
 *
 * Usage:
 *   pnpm test:contract --filter api-platform
 *   pnpm test:contract --filter identity-profile
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

const selected = filters.length > 0 ? filters : ["api-platform"];

const contractSuites: Record<string, string> = {
  "api-platform": "src/platform/platform.contract.test.ts",
  "identity-profile": "src/modules/identity/identity.contract.test.ts",
  consent: "src/modules/identity/consent.contract.test.ts",
  "content-ops": "src/modules/content/content.contract.test.ts",
  curriculum: "src/modules/content/curriculum.contract.test.ts",
  onboarding: "src/modules/learner/onboarding.contract.test.ts",
  learning: "src/modules/learning/learning.contract.test.ts",
};

for (const name of selected) {
  const file = contractSuites[name];
  if (!file) {
    console.error(`Unknown contract filter: ${name}`);
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
