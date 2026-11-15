import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { paragraph } from "@deutsch-mate/content-schemas";
import { describe, expect, it } from "vitest";

import { asActivityView } from "./activity-view.js";
import { collectAssetReferences, validateAssetFiles } from "./assets.js";
import { SMOKE_AUDIO_SHA256 } from "./fixtures/build-smoke.js";

describe("validateAssetFiles", () => {
  it("verifies presence and sha256", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dm-assets-"));
    mkdirSync(path.join(dir, "assets"));
    const bytes = Buffer.from("DM-SMOKE-AUDIO-PLACEHOLDER\n", "utf8");
    writeFileSync(path.join(dir, "assets", "u1.bin"), bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(SMOKE_AUDIO_SHA256);

    const activity = asActivityView({
      schemaVersion: 1,
      activityKey: "act.a1.smoke.u1.listening",
      version: 1,
      type: "listening",
      level: "A1",
      prompt: paragraph("Listen"),
      maxScore: "1.000",
      required: true,
      objectives: [{ objectiveKey: "obj.a1.smoke.u1", objectiveVersion: 1, weight: "1.0" }],
      assets: [
        {
          assetKey: "asset.a1.smoke.u1.audio",
          purpose: "audio",
          ordinal: 1,
          contentType: "audio/mpeg",
          sourcePath: "assets/u1.bin",
          sha256: SMOKE_AUDIO_SHA256,
          altText: "Smoke audio",
        },
      ],
      configuration: {
        items: [
          {
            type: "selection",
            prompt: paragraph("Q"),
            configuration: {
              mode: "single",
              options: [
                { id: "a", label: paragraph("A") },
                { id: "b", label: paragraph("B") },
              ],
            },
            answerKey: {
              version: 1,
              scoringAlgorithmVersion: "selection.single.v1",
              answerSpec: { kind: "set", values: ["a"] },
              maxScore: "1.000",
            },
          },
        ],
      },
      transcriptPolicy: "always",
    });

    const refs = collectAssetReferences([{ activity }]);
    const ok = validateAssetFiles(dir, refs);
    expect(ok.ok).toBe(true);

    const bad = validateAssetFiles(dir, [
      {
        activityKey: activity.activityKey,
        asset: { ...activity.assets[0]!, sha256: "0".repeat(64) },
      },
    ]);
    expect(bad.ok).toBe(false);
  });
});
