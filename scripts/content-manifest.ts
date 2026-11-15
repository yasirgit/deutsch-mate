#!/usr/bin/env node
/**
 * Build and write a deterministic manifest.json for a release directory.
 *
 * Usage: pnpm content:manifest [--dir content/fixtures/import-smoke]
 */
import path from "node:path";

import { validateRelease } from "@deutsch-mate/content-pipeline";

import { repoRoot } from "./lib/env.ts";

function parseDir(argv: string[]): string {
  const idx = argv.indexOf("--dir");
  if (idx >= 0 && argv[idx + 1] !== undefined) {
    return path.resolve(repoRoot, argv[idx + 1]!);
  }
  return path.join(repoRoot, "content/fixtures/import-smoke");
}

const dir = parseDir(process.argv.slice(2));
const result = validateRelease({ dir, writeManifestFile: true });

if (!result.inventory.ok) {
  console.error(`content:manifest FAILED — inventory errors in ${dir}`);
  for (const issue of result.inventory.issues) {
    console.error(`  [${issue.code}] ${issue.path}: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(`content:manifest OK — wrote ${result.manifestPath}`);
  console.log(`  manifestSha256=${result.manifest.manifestSha256}`);
  console.log(`  entries=${result.manifest.entries.length}`);
}
