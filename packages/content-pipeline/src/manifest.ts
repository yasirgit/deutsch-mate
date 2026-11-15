import { writeFileSync } from "node:fs";
import path from "node:path";

import { canonicalizeJson, sha256Hex } from "@deutsch-mate/domain";

import type { LoadedRelease } from "./inventory.js";

export interface ContentManifestEntry {
  readonly kind: string;
  readonly key: string;
  readonly version: number;
  readonly contentSha256: string;
}

export interface ContentManifest {
  readonly schemaVersion: 1;
  readonly releaseKey: string;
  readonly releaseVersion: number;
  readonly generatedAt: string;
  readonly manifestSha256: string;
  readonly entries: readonly ContentManifestEntry[];
}

function entrySha(document: unknown): string {
  return sha256Hex(canonicalizeJson(document));
}

function sortEntries(entries: ContentManifestEntry[]): ContentManifestEntry[] {
  return [...entries].sort((a, b) => {
    const kind = a.kind.localeCompare(b.kind);
    if (kind !== 0) {
      return kind;
    }
    const key = a.key.localeCompare(b.key);
    if (key !== 0) {
      return key;
    }
    return a.version - b.version;
  });
}

/**
 * Build a deterministic release manifest (sorted keys, content version hashes).
 */
export function buildManifest(
  loaded: LoadedRelease,
  generatedAt: string = new Date().toISOString(),
): ContentManifest {
  const entries: ContentManifestEntry[] = [
    {
      kind: "release",
      key: loaded.release.releaseKey,
      version: loaded.release.version,
      contentSha256: entrySha(loaded.release),
    },
    ...loaded.descriptors.map((d) => ({
      kind: "cefr_descriptor" as const,
      key: d.descriptorKey,
      version: d.version,
      contentSha256: entrySha(d),
    })),
    ...loaded.objectives.map((o) => ({
      kind: "objective" as const,
      key: o.objectiveKey,
      version: o.version,
      contentSha256: entrySha(o),
    })),
    ...loaded.modules.map((m) => ({
      kind: "module" as const,
      key: m.moduleKey,
      version: m.version,
      contentSha256: entrySha(m),
    })),
    ...loaded.units.map((u) => ({
      kind: "unit" as const,
      key: u.unitKey,
      version: u.version,
      contentSha256: entrySha(u),
    })),
  ];

  const sorted = sortEntries(entries);
  const stableBody = {
    schemaVersion: 1 as const,
    releaseKey: loaded.release.releaseKey,
    releaseVersion: loaded.release.version,
    entries: sorted,
  };
  const manifestSha256 = sha256Hex(canonicalizeJson(stableBody));
  return {
    ...stableBody,
    generatedAt,
    manifestSha256,
  };
}

/**
 * Write `manifest.json` into the release directory. Returns the written path.
 */
export function writeManifest(loaded: LoadedRelease, generatedAt?: string): {
  readonly manifest: ContentManifest;
  readonly path: string;
} {
  const manifest = buildManifest(loaded, generatedAt);
  const outPath = path.join(loaded.releaseDir, "manifest.json");
  // Stable pretty JSON with sorted object key order via canonicalize + parse.
  const stable = JSON.parse(canonicalizeJson(manifest)) as ContentManifest;
  writeFileSync(outPath, `${JSON.stringify(stable, null, 2)}\n`, "utf8");
  return { manifest, path: outPath };
}
