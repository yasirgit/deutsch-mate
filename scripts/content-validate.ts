#!/usr/bin/env node
/**
 * Validate a content release directory (schema + MVP G1 inventory + assets).
 *
 * Usage: pnpm content:validate [--dir content/fixtures/import-smoke]
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
const result = validateRelease({ dir });

if (!result.inventory.ok) {
  console.error(`content:validate FAILED for ${dir}`);
  for (const issue of result.inventory.issues) {
    console.error(`  [${issue.code}] ${issue.path}: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(`content:validate OK — ${dir}`);
  console.log(
    `  release ${result.loaded.release.releaseKey}@${result.loaded.release.version}; ` +
      `${result.loaded.modules.length} module(s), ${result.loaded.units.length} unit(s); ` +
      `manifestSha256=${result.manifest.manifestSha256}`,
  );
}
