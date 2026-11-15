import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadLocalEnv, repoRoot } from "./lib/env.ts";
import { waitForServices } from "./wait-for-services.ts";

function fail(message: string): never {
  console.error(`[bootstrap] ${message}`);
  process.exit(1);
}

function run(command: string, args: readonly string[]): { ok: boolean; stdout: string } {
  const result = spawnSync(command, [...args], { cwd: repoRoot, encoding: "utf8" });
  return { ok: result.status === 0 && result.error === undefined, stdout: result.stdout ?? "" };
}

function checkNodeVersion(): void {
  const pinnedMajor = readFileSync(path.join(repoRoot, ".nvmrc"), "utf8").trim();
  const actual = process.versions.node;
  const actualMajor = actual.split(".")[0] ?? "";
  if (actualMajor !== pinnedMajor) {
    fail(
      `Node ${actual} does not match the pinned major version ${pinnedMajor} (.nvmrc). ` +
        `Install Node ${pinnedMajor} (for example \`nvm use\`) and retry.`,
    );
  }
  console.log(`[bootstrap] Node ${actual} matches pinned major ${pinnedMajor}.`);
}

function checkPnpmVersion(): void {
  const rootManifest = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ) as Readonly<{ packageManager?: string }>;
  const pin = rootManifest.packageManager ?? "";
  const match = /^pnpm@(\d+\.\d+\.\d+)/.exec(pin);
  if (match === null || match[1] === undefined) {
    fail(`Root package.json has no parseable pnpm "packageManager" pin (found "${pin}").`);
  }
  const pinned = match[1];
  const version = run("pnpm", ["--version"]);
  if (!version.ok) {
    fail("pnpm is not available on PATH. Run `corepack enable` and retry.");
  }
  const actual = version.stdout.trim();
  if (actual !== pinned) {
    fail(
      `pnpm ${actual} does not match the pinned ${pinned} (package.json "packageManager"). ` +
        `Run \`corepack enable\` so corepack provides the pinned version.`,
    );
  }
  console.log(`[bootstrap] pnpm ${actual} matches pin.`);
}

function ensureDotEnv(): void {
  const target = path.join(repoRoot, ".env");
  if (existsSync(target)) {
    console.log("[bootstrap] .env already exists; leaving it untouched.");
    return;
  }
  copyFileSync(path.join(repoRoot, ".env.example"), target);
  console.log("[bootstrap] Created .env from .env.example (local-only placeholders).");
}

function checkDocker(): void {
  const info = run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (!info.ok) {
    fail(
      "Docker is not available. Local services (PostgreSQL, Redis) require a running " +
        "Docker daemon with Compose v2.\n" +
        "  - Install Docker Desktop (or an equivalent daemon) and start it.\n" +
        "  - Verify with `docker info` and `docker compose version`, then rerun `pnpm bootstrap`.",
    );
  }
  console.log(`[bootstrap] Docker daemon is running (server ${info.stdout.trim()}).`);
}

function startServices(): void {
  console.log("[bootstrap] Starting local services via `docker compose up -d --wait`...");
  const result = spawnSync("docker", ["compose", "up", "-d", "--wait"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0 || result.error !== undefined) {
    fail("`docker compose up -d --wait` failed; see output above.");
  }
}

async function main(): Promise<void> {
  checkNodeVersion();
  checkPnpmVersion();
  ensureDotEnv();
  checkDocker();
  startServices();
  await waitForServices(loadLocalEnv());
  console.log(
    "[bootstrap] Done. Next steps: `pnpm db:reset` to (re)create the dev database, " +
      "`pnpm test:smoke` to verify the stack, `pnpm dev` to start app dev tasks.",
  );
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
