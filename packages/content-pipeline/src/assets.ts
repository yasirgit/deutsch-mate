import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { ActivityAssetView, ActivityView } from "./activity-view.js";

export interface AssetReference {
  readonly activityKey: string;
  readonly asset: ActivityAssetView;
}

export interface AssetValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface AssetValidationResult {
  readonly ok: boolean;
  readonly issues: readonly AssetValidationIssue[];
  readonly verified: readonly string[];
}

/**
 * Collect asset references from activities.
 */
export function collectAssetReferences(
  activities: readonly { activity: ActivityView }[],
): readonly AssetReference[] {
  const refs: AssetReference[] = [];
  for (const link of activities) {
    for (const asset of link.activity.assets) {
      refs.push({ activityKey: link.activity.activityKey, asset });
    }
  }
  return refs;
}

/**
 * Verify each referenced asset exists under `releaseDir` and matches sha256.
 */
export function validateAssetFiles(
  releaseDir: string,
  refs: readonly AssetReference[],
): AssetValidationResult {
  const issues: AssetValidationIssue[] = [];
  const verified: string[] = [];
  const seen = new Set<string>();
  const root = path.resolve(releaseDir);

  for (const ref of refs) {
    const rel = ref.asset.sourcePath;
    const abs = path.resolve(releaseDir, rel);
    const label = `${ref.activityKey}/${ref.asset.assetKey}`;

    if (!abs.startsWith(root + path.sep) && abs !== root) {
      issues.push({
        path: label,
        message: `asset path escapes release directory: ${rel}`,
      });
      continue;
    }

    if (!existsSync(abs) || !statSync(abs).isFile()) {
      issues.push({
        path: label,
        message: `asset file missing: ${rel}`,
      });
      continue;
    }

    const digest = createHash("sha256").update(readFileSync(abs)).digest("hex");
    if (digest !== ref.asset.sha256) {
      issues.push({
        path: label,
        message: `sha256 mismatch for ${rel}: expected ${ref.asset.sha256}, got ${digest}`,
      });
      continue;
    }

    const dedupe = `${rel}:${ref.asset.sha256}`;
    if (!seen.has(dedupe)) {
      seen.add(dedupe);
      verified.push(abs);
    }
  }

  return { ok: issues.length === 0, issues, verified };
}
