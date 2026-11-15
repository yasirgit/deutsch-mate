/**
 * Fails if committed generated OpenAPI artifacts drift from a fresh generation.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const generatedRel = "packages/api-schemas/src/generated/openapi.ts";

function run(command: string, args: string[], options?: { stdio?: "inherit" | "pipe" }) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options?.stdio ?? "inherit",
    env: process.env,
    shell: false,
  });
}

const generate = run("pnpm", ["exec", "tsx", "scripts/openapi/generate.ts"]);
if (generate.status !== 0) {
  process.exit(generate.status === null ? 1 : generate.status);
}

const diff = run("git", ["diff", "--exit-code", "--", generatedRel], { stdio: "pipe" });
if (diff.status === 0) {
  console.log("openapi:drift — generated artifacts match the working tree");
  process.exit(0);
}

if (diff.status === 1) {
  console.error("openapi:drift — generated OpenAPI artifacts are dirty:");
  process.stderr.write(diff.stdout);
  process.stderr.write(diff.stderr);
  process.exit(1);
}

console.error(diff.stderr || "git diff failed");
process.exit(diff.status === null ? 1 : diff.status);
