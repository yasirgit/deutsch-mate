/**
 * Root security test runner.
 *
 * Usage:
 *   pnpm test:security --filter oidc --filter account-isolation
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

const securitySuites: Record<string, string> = {
  oidc: "src/modules/identity/oidc.security.test.ts",
  "account-isolation": "src/modules/identity/account-isolation.security.test.ts",
};

const selected = filters.length > 0 ? filters : Object.keys(securitySuites);

for (const name of selected) {
  const file = securitySuites[name];
  if (!file) {
    console.error(`Unknown security filter: ${name}`);
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
