import { describe, expect, it } from "vitest";

import {
  prerequisitesAreAcyclic,
  validateReleaseInventory,
  type LoadedRelease,
} from "./inventory.js";
import { buildSmokeReleaseDocuments } from "./fixtures/build-smoke.js";
import type { ReleaseMeta } from "./release-meta.js";
import type { UnitAuthoring } from "@deutsch-mate/content-schemas";

function loadedFromSmoke(releaseDir = "/tmp/smoke"): LoadedRelease {
  const docs = buildSmokeReleaseDocuments();
  return {
    releaseDir,
    release: docs.release,
    descriptors: docs.descriptors,
    objectives: docs.objectives,
    modules: [docs.module],
    units: docs.units,
  };
}

describe("prerequisitesAreAcyclic", () => {
  it("accepts a linear chain", () => {
    const units = loadedFromSmoke().units;
    expect(prerequisitesAreAcyclic(units).ok).toBe(true);
  });

  it("rejects a cycle", () => {
    const units = loadedFromSmoke().units.map((u) => ({ ...u })) as UnitAuthoring[];
    const first = units[0]!;
    const last = units[units.length - 1]!;
    units[0] = {
      ...first,
      prerequisites: [{ unitKey: last.unitKey, unitVersion: last.version }],
    };
    expect(prerequisitesAreAcyclic(units).ok).toBe(false);
  });
});

describe("validateReleaseInventory", () => {
  it("accepts the smoke release shape when assets are present on disk", async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const docs = buildSmokeReleaseDocuments();
    const dir = mkdtempSync(path.join(tmpdir(), "dm-smoke-"));
    mkdirSync(path.join(dir, "assets"), { recursive: true });
    for (let i = 1; i <= 6; i += 1) {
      writeFileSync(path.join(dir, "assets", `u${i}.bin`), docs.audioBytes);
    }
    const loaded: LoadedRelease = {
      releaseDir: dir,
      release: docs.release,
      descriptors: docs.descriptors,
      objectives: docs.objectives,
      modules: [docs.module],
      units: docs.units,
    };
    const result = validateReleaseInventory(loaded);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects modules with fewer than six units", () => {
    const docs = buildSmokeReleaseDocuments();
    const shortModule = {
      ...docs.module,
      units: docs.module.units.slice(0, 3),
    };
    const loaded: LoadedRelease = {
      releaseDir: "/tmp/unused",
      release: docs.release,
      descriptors: docs.descriptors,
      objectives: docs.objectives,
      modules: [shortModule],
      units: docs.units.slice(0, 3),
    };
    const result = validateReleaseInventory(loaded);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "unit_count")).toBe(true);
  });

  it("rejects prohibited certification copy in titles", () => {
    const docs = buildSmokeReleaseDocuments();
    const release: ReleaseMeta = {
      ...docs.release,
      title: "Official CEFR certification track",
    };
    const result = validateReleaseInventory({
      releaseDir: "/tmp/unused",
      release,
      descriptors: docs.descriptors,
      objectives: docs.objectives,
      modules: [docs.module],
      units: docs.units,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "prohibited_copy")).toBe(true);
  });
});
