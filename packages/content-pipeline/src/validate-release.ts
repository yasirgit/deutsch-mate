import type { LoadedRelease } from "./inventory.js";
import { validateReleaseInventory, type InventoryResult } from "./inventory.js";
import { loadReleaseDirectory } from "./load.js";
import { buildManifest, writeManifest, type ContentManifest } from "./manifest.js";

export interface ValidateReleaseOptions {
  readonly dir: string;
  /** When true, write manifest.json after a successful inventory check. */
  readonly writeManifestFile?: boolean;
  readonly generatedAt?: string;
}

export interface ValidateReleaseResult {
  readonly loaded: LoadedRelease;
  readonly inventory: InventoryResult;
  readonly manifest: ContentManifest;
  readonly manifestPath?: string;
}

/**
 * Load, schema-validate, run inventory rules, and optionally write the manifest.
 */
export function validateRelease(options: ValidateReleaseOptions): ValidateReleaseResult {
  const loaded = loadReleaseDirectory(options.dir);
  const inventory = validateReleaseInventory(loaded);
  if (!inventory.ok) {
    const manifest = buildManifest(loaded, options.generatedAt);
    return { loaded, inventory, manifest };
  }
  if (options.writeManifestFile === true) {
    const written = writeManifest(loaded, options.generatedAt);
    return {
      loaded,
      inventory,
      manifest: written.manifest,
      manifestPath: written.path,
    };
  }
  return {
    loaded,
    inventory,
    manifest: buildManifest(loaded, options.generatedAt),
  };
}
