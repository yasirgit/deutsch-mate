import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  ContentValidationError,
  validateContentDocument,
  type CefrDescriptorAuthoring,
  type ModuleAuthoring,
  type ObjectiveAuthoring,
  type UnitAuthoring,
} from "@deutsch-mate/content-schemas";

import type { LoadedRelease } from "./inventory.js";
import { ReleaseMetaSchema, type ReleaseMeta } from "./release-meta.js";

export class ReleaseLoadError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[]) {
    super(message);
    this.name = "ReleaseLoadError";
    this.issues = issues;
  }
}

function listJsonFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "assets" || entry.name === "node_modules") {
          continue;
        }
        walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== "manifest.json") {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.localeCompare(b));
}

function parseJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ReleaseLoadError(`Failed to parse ${filePath}`, [reason]);
  }
}

/**
 * Load and schema-validate all authoring documents under a release directory.
 * Expects `release.json` plus descriptor/objective/module/unit JSON files.
 */
export function loadReleaseDirectory(releaseDir: string): LoadedRelease {
  const absDir = path.resolve(releaseDir);
  const issues: string[] = [];

  const releasePath = path.join(absDir, "release.json");
  let release: ReleaseMeta;
  try {
    const parsed = ReleaseMetaSchema.safeParse(parseJsonFile(releasePath));
    if (!parsed.success) {
      throw new ReleaseLoadError(
        "Invalid release.json",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      );
    }
    release = parsed.data;
  } catch (error) {
    if (error instanceof ReleaseLoadError) {
      throw error;
    }
    throw new ReleaseLoadError(`Missing or unreadable release.json in ${absDir}`, [
      error instanceof Error ? error.message : String(error),
    ]);
  }

  const descriptors: CefrDescriptorAuthoring[] = [];
  const objectives: ObjectiveAuthoring[] = [];
  const modules: ModuleAuthoring[] = [];
  const units: UnitAuthoring[] = [];

  for (const filePath of listJsonFiles(absDir)) {
    if (path.basename(filePath) === "release.json") {
      continue;
    }
    const raw = parseJsonFile(filePath);
    const rel = path.relative(absDir, filePath);
    try {
      const { document } = validateContentDocument(raw);
      switch (document.kind) {
        case "cefr_descriptor":
          descriptors.push(document);
          break;
        case "objective":
          objectives.push(document);
          break;
        case "module":
          modules.push(document);
          break;
        case "unit":
          units.push(document);
          break;
        default: {
          const _exhaustive: never = document;
          void _exhaustive;
        }
      }
    } catch (error) {
      if (error instanceof ContentValidationError) {
        for (const issue of error.issues) {
          issues.push(`${rel}: ${issue}`);
        }
      } else {
        issues.push(`${rel}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (issues.length > 0) {
    throw new ReleaseLoadError(`Schema validation failed for ${absDir}`, issues);
  }

  return {
    releaseDir: absDir,
    release,
    descriptors,
    objectives,
    modules,
    units,
  };
}
