/**
 * Root authorization test runner.
 *
 * Usage:
 *   pnpm test:authorization --filter content
 *   pnpm test:authorization --filter rls
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

const selected = filters.length > 0 ? filters : ["rls", "content"];

const suites: Record<
  string,
  { readonly cwd: string; readonly args: readonly string[] }
> = {
  rls: {
    cwd: databasePackage,
    args: ["exec", "vitest", "run", "--config", "vitest.config.ts", "src/authorization.integration.test.ts"],
  },
  content: {
    cwd: root,
    args: [
      "--filter",
      "@deutsch-mate/api",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.config.ts",
      "src/modules/content/content.authorization.test.ts",
    ],
  },
};

for (const name of selected) {
  const suite = suites[name];
  if (!suite) {
    console.error(`Unknown authorization filter: ${name}`);
    process.exit(1);
  }
  const result = spawnSync("pnpm", [...suite.args], {
    cwd: suite.cwd,
    stdio: "inherit",
    env: process.env,
  });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.exit(0);
