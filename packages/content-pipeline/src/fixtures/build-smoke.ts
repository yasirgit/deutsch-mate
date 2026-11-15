import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  paragraph,
  type CefrDescriptorAuthoring,
  type ModuleAuthoring,
  type ObjectiveAuthoring,
  type UnitAuthoring,
} from "@deutsch-mate/content-schemas";

import { asActivityView, type ActivityView } from "../activity-view.js";
import type { ReleaseMeta } from "../release-meta.js";

/** Minimal smoke release: 1 module × 6 units meeting MVP G1 inventory counts. */

const AUDIO_BYTES = Buffer.from("DM-SMOKE-AUDIO-PLACEHOLDER\n", "utf8");
export const SMOKE_AUDIO_SHA256 = createHash("sha256").update(AUDIO_BYTES).digest("hex");

function selectionActivity(
  unitOrdinal: number,
  index: number,
  objectiveKey: string,
): ActivityView {
  const n = String(index).padStart(2, "0");
  const optionA = `opt_a_${n}`;
  const optionB = `opt_b_${n}`;
  return asActivityView({
    schemaVersion: 1,
    activityKey: `act.a1.smoke.u${unitOrdinal}.sel${n}`,
    version: 1,
    type: "selection",
    level: "A1",
    prompt: paragraph(`Smoke selection ${index} for unit ${unitOrdinal}.`),
    maxScore: "1.000",
    required: true,
    objectives: [{ objectiveKey, objectiveVersion: 1, weight: "1.0" }],
    assets: [],
    configuration: {
      mode: "single",
      options: [
        { id: optionA, label: paragraph("Option A") },
        { id: optionB, label: paragraph("Option B") },
      ],
    },
    transcriptPolicy: null,
    answerKey: {
      version: 1,
      scoringAlgorithmVersion: "selection.single.v1",
      answerSpec: { kind: "set", values: [optionA] },
      maxScore: "1.000",
    },
  });
}

function buildUnit(unitOrdinal: number): {
  unit: UnitAuthoring;
  objective: ObjectiveAuthoring;
  descriptor: CefrDescriptorAuthoring;
} {
  const objectiveKey = `obj.a1.smoke.u${unitOrdinal}`;
  const descriptorKey = `cefr.a1.smoke.u${unitOrdinal}`;
  const unitKey = `unit.a1.smoke.u${unitOrdinal}`;
  const objective: ObjectiveAuthoring = {
    schemaVersion: 1,
    kind: "objective",
    objectiveKey,
    version: 1,
    level: "A1",
    skill: "vocabulary",
    title: `Smoke objective ${unitOrdinal}`,
    description: `CEFR-aligned A1 vocabulary objective for smoke unit ${unitOrdinal}.`,
    descriptors: [{ descriptorKey, descriptorVersion: 1 }],
  };
  const descriptor: CefrDescriptorAuthoring = {
    schemaVersion: 1,
    kind: "cefr_descriptor",
    descriptorKey,
    version: 1,
    level: "A1",
    skill: "vocabulary",
    sourceName: "Common European Framework of Reference for Languages",
    sourceEdition: "Companion Volume 2020",
    descriptorText: `Can use basic expressions for smoke unit ${unitOrdinal}.`,
  };

  const practice: { ordinal: number; activity: ActivityView }[] = [];
  for (let i = 1; i <= 12; i += 1) {
    practice.push({ ordinal: i, activity: selectionActivity(unitOrdinal, i, objectiveKey) });
  }

  const listening = asActivityView({
    schemaVersion: 1,
    activityKey: `act.a1.smoke.u${unitOrdinal}.listening`,
    version: 1,
    type: "listening",
    level: "A1",
    prompt: paragraph("Listen to the smoke audio clip."),
    maxScore: "1.000",
    required: true,
    objectives: [{ objectiveKey, objectiveVersion: 1, weight: "1.0" }],
    assets: [
      {
        assetKey: `asset.a1.smoke.u${unitOrdinal}.audio`,
        purpose: "audio",
        ordinal: 1,
        contentType: "audio/mpeg",
        sourcePath: `assets/u${unitOrdinal}.bin`,
        sha256: SMOKE_AUDIO_SHA256,
        altText: `Smoke audio for unit ${unitOrdinal}`,
        transcript: paragraph("Hallo."),
      },
    ],
    configuration: {
      items: [
        {
          type: "selection",
          prompt: paragraph("What did you hear?"),
          configuration: {
            mode: "single",
            options: [
              { id: "hallo", label: paragraph("Hallo") },
              { id: "tschuss", label: paragraph("Tschüss") },
            ],
          },
          answerKey: {
            version: 1,
            scoringAlgorithmVersion: "selection.single.v1",
            answerSpec: { kind: "set", values: ["hallo"] },
            maxScore: "1.000",
          },
        },
      ],
    },
    transcriptPolicy: "after_first_submission",
  });

  const writing = asActivityView({
    schemaVersion: 1,
    activityKey: `act.a1.smoke.u${unitOrdinal}.writing`,
    version: 1,
    type: "writing",
    level: "A1",
    prompt: paragraph("Write a short greeting."),
    maxScore: "4.000",
    required: true,
    objectives: [{ objectiveKey, objectiveVersion: 1, weight: "1.0" }],
    assets: [],
    configuration: { minChars: 5, maxChars: 120 },
    transcriptPolicy: null,
    rubric: {
      rubricKey: `rubric.a1.smoke.u${unitOrdinal}.writing`,
      version: 1,
      dimensions: [
        {
          code: "task_completion",
          title: "Task completion",
          description: paragraph("Completes the greeting task."),
          maxPoints: "1.000",
        },
        {
          code: "grammar",
          title: "Grammar",
          description: paragraph("Acceptable A1 grammar."),
          maxPoints: "1.000",
        },
        {
          code: "vocabulary",
          title: "Vocabulary",
          description: paragraph("Uses expected vocabulary."),
          maxPoints: "1.000",
        },
        {
          code: "clarity",
          title: "Clarity",
          description: paragraph("Meaning is clear."),
          maxPoints: "1.000",
        },
      ],
      scoringRule: { kind: "sum_dimensions", passThreshold: "2.500" },
    },
  });

  const formative = asActivityView({
    schemaVersion: 1,
    activityKey: `act.a1.smoke.u${unitOrdinal}.formative`,
    version: 1,
    type: "formative_check",
    level: "A1",
    prompt: paragraph("Quick formative check."),
    maxScore: "1.000",
    required: true,
    objectives: [{ objectiveKey, objectiveVersion: 1, weight: "1.0" }],
    assets: [],
    configuration: {
      items: [
        {
          type: "selection",
          prompt: paragraph("Pick the greeting."),
          configuration: {
            mode: "single",
            options: [
              { id: "hallo", label: paragraph("Hallo") },
              { id: "nein", label: paragraph("Nein") },
            ],
          },
          answerKey: {
            version: 1,
            scoringAlgorithmVersion: "selection.single.v1",
            answerSpec: { kind: "set", values: ["hallo"] },
            maxScore: "1.000",
          },
        },
      ],
    },
    transcriptPolicy: null,
  });

  practice.push(
    { ordinal: 13, activity: listening },
    { ordinal: 14, activity: writing },
    { ordinal: 15, activity: formative },
  );

  const prerequisites =
    unitOrdinal === 1
      ? []
      : [{ unitKey: `unit.a1.smoke.u${unitOrdinal - 1}`, unitVersion: 1 }];

  const unit = {
    schemaVersion: 1,
    kind: "unit",
    unitKey,
    version: 1,
    moduleKey: "mod.a1.smoke",
    level: "A1",
    title: `Smoke unit ${unitOrdinal}`,
    summary: `Minimal inventory unit ${unitOrdinal} for import smoke tests.`,
    ordinal: unitOrdinal,
    estimatedMinutes: 25,
    accessTier: unitOrdinal === 1 ? "free" : "premium",
    prerequisites,
    objectives: [{ objectiveKey, objectiveVersion: 1, isPrimary: true }],
    lessons: [
      {
        ordinal: 1,
        required: true,
        lesson: {
          lessonKey: `lesson.a1.smoke.u${unitOrdinal}.core`,
          version: 1,
          title: `Smoke lesson ${unitOrdinal}`,
          explanation: paragraph(`Explanation for smoke unit ${unitOrdinal}.`),
          examples: paragraph(`Example for smoke unit ${unitOrdinal}.`),
          completionRule: { kind: "required_activities", requireAllRequired: true },
          estimatedMinutes: 20,
          activities: practice,
        },
      },
    ],
  } as UnitAuthoring;

  return { unit, objective, descriptor };
}

export function buildSmokeReleaseDocuments(): {
  release: ReleaseMeta;
  module: ModuleAuthoring;
  units: UnitAuthoring[];
  objectives: ObjectiveAuthoring[];
  descriptors: CefrDescriptorAuthoring[];
  audioBytes: Buffer;
} {
  const units: UnitAuthoring[] = [];
  const objectives: ObjectiveAuthoring[] = [];
  const descriptors: CefrDescriptorAuthoring[] = [];
  for (let i = 1; i <= 6; i += 1) {
    const built = buildUnit(i);
    units.push(built.unit);
    objectives.push(built.objective);
    descriptors.push(built.descriptor);
  }

  const module: ModuleAuthoring = {
    schemaVersion: 1,
    kind: "module",
    moduleKey: "mod.a1.smoke",
    version: 1,
    level: "A1",
    title: "A1 Smoke Module",
    description: "Import-smoke module with six minimal units meeting MVP G1 inventory rules.",
    ordinal: 1,
    units: units.map((u) => ({
      ordinal: u.ordinal,
      unitKey: u.unitKey,
      unitVersion: u.version,
    })),
  };

  const release: ReleaseMeta = {
    schemaVersion: 1,
    kind: "release",
    releaseKey: "release.import.smoke",
    version: 1,
    title: "Import smoke release",
    description: "Deterministic fixture for content validate/manifest/import (DM-030).",
    modules: [{ ordinal: 1, moduleKey: module.moduleKey, moduleVersion: module.version }],
  };

  return { release, module, units, objectives, descriptors, audioBytes: AUDIO_BYTES };
}

/** Write smoke fixture under content/fixtures/import-smoke/. */
export function writeSmokeFixture(repoRoot: string): string {
  const outDir = path.join(repoRoot, "content/fixtures/import-smoke");
  const assetsDir = path.join(outDir, "assets");
  mkdirSync(assetsDir, { recursive: true });
  mkdirSync(path.join(outDir, "descriptors"), { recursive: true });
  mkdirSync(path.join(outDir, "objectives"), { recursive: true });
  mkdirSync(path.join(outDir, "modules"), { recursive: true });
  mkdirSync(path.join(outDir, "units"), { recursive: true });

  const docs = buildSmokeReleaseDocuments();
  writeFileSync(path.join(outDir, "release.json"), `${JSON.stringify(docs.release, null, 2)}\n`);
  writeFileSync(
    path.join(outDir, "modules", "mod.a1.smoke.json"),
    `${JSON.stringify(docs.module, null, 2)}\n`,
  );
  for (const descriptor of docs.descriptors) {
    writeFileSync(
      path.join(outDir, "descriptors", `${descriptor.descriptorKey}.json`),
      `${JSON.stringify(descriptor, null, 2)}\n`,
    );
  }
  for (const objective of docs.objectives) {
    writeFileSync(
      path.join(outDir, "objectives", `${objective.objectiveKey}.json`),
      `${JSON.stringify(objective, null, 2)}\n`,
    );
  }
  for (const unit of docs.units) {
    writeFileSync(
      path.join(outDir, "units", `${unit.unitKey}.json`),
      `${JSON.stringify(unit, null, 2)}\n`,
    );
    writeFileSync(path.join(assetsDir, `u${unit.ordinal}.bin`), docs.audioBytes);
  }

  writeFileSync(
    path.join(outDir, "README.md"),
    `# Import smoke fixture

Minimal 1×6 A1 release for DM-030 validation/import. Not editorial launch content
(DM-033/DM-034). Regenerate via \`pnpm --filter @deutsch-mate/content-pipeline exec tsx src/fixtures/write-smoke.ts\`.
`,
  );

  return outDir;
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const out = writeSmokeFixture(repoRoot);
  console.log(`Wrote smoke fixture to ${out}`);
}
