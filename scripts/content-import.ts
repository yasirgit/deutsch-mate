#!/usr/bin/env node
/**
 * Import a validated release into PostgreSQL as draft (idempotent on key+version).
 *
 * Uses DATABASE_URL / local owner connection (see packages/content-pipeline/README.md).
 *
 * Usage: pnpm content:import [--dir content/fixtures/import-smoke]
 */
import path from "node:path";

import { importRelease, validateRelease } from "@deutsch-mate/content-pipeline";

import { loadLocalEnv, repoRoot } from "./lib/env.ts";

function parseDir(argv: string[]): string {
  const idx = argv.indexOf("--dir");
  if (idx >= 0 && argv[idx + 1] !== undefined) {
    return path.resolve(repoRoot, argv[idx + 1]!);
  }
  return path.join(repoRoot, "content/fixtures/import-smoke");
}

const dir = parseDir(process.argv.slice(2));
const env = loadLocalEnv();
const validated = validateRelease({ dir, writeManifestFile: true });

if (!validated.inventory.ok) {
  console.error(`content:import refused — inventory failed for ${dir}`);
  for (const issue of validated.inventory.issues) {
    console.error(`  [${issue.code}] ${issue.path}: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  const result = await importRelease({
    connectionString: env.databaseUrl,
    loaded: validated.loaded,
  });
  console.log(`content:import OK — draft release ${result.releaseKey}@${result.releaseVersion}`);
  console.log(`  releaseId=${result.releaseId}`);
  console.log(`  manifestSha256=${result.manifestSha256}`);
  console.log(`  inserted=${JSON.stringify(result.inserted)}`);
  console.log(`  skippedExisting=${result.skippedExisting}`);
}
