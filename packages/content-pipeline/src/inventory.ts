import type {
  CefrDescriptorAuthoring,
  ModuleAuthoring,
  ObjectiveAuthoring,
  UnitAuthoring,
} from "@deutsch-mate/content-schemas";

import { asActivityView, type ActivityView } from "./activity-view.js";
import { collectAssetReferences, validateAssetFiles } from "./assets.js";
import { findProhibitedCertificationCopy } from "./prohibited-copy.js";
import type { ReleaseMeta } from "./release-meta.js";

export const MIN_DETERMINISTIC_INTERACTIONS = 12;
export const REQUIRED_UNITS_PER_MODULE = 6;

const DETERMINISTIC_TYPES: ReadonlySet<string> = new Set([
  "selection",
  "matching",
  "ordering",
  "cloze",
  "typed_response",
]);

export interface LoadedRelease {
  readonly releaseDir: string;
  readonly release: ReleaseMeta;
  readonly descriptors: readonly CefrDescriptorAuthoring[];
  readonly objectives: readonly ObjectiveAuthoring[];
  readonly modules: readonly ModuleAuthoring[];
  readonly units: readonly UnitAuthoring[];
}

export interface InventoryIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface InventoryResult {
  readonly ok: boolean;
  readonly issues: readonly InventoryIssue[];
}

function versionKey(key: string, version: number): string {
  return `${key}@${version}`;
}

function sumWeights(weights: readonly string[]): number {
  let total = 0;
  for (const w of weights) {
    const [whole, frac = ""] = w.split(".");
    const padded = (frac + "0000").slice(0, 4);
    total += Number(whole) * 10_000 + Number(padded);
  }
  return total;
}

function countDeterministicInteractions(activity: ActivityView): number {
  if (DETERMINISTIC_TYPES.has(activity.type)) {
    return 1;
  }
  if (activity.type === "listening" || activity.type === "formative_check") {
    return (activity.configuration.items ?? []).filter((item) =>
      DETERMINISTIC_TYPES.has(item.type),
    ).length;
  }
  return 0;
}

export function activitiesOfUnit(unit: UnitAuthoring): ActivityView[] {
  return unit.lessons.flatMap((lesson) =>
    lesson.lesson.activities.map((a) => asActivityView(a.activity)),
  );
}

function hasAnswerCoverage(activity: ActivityView): boolean {
  switch (activity.type) {
    case "selection":
    case "matching":
    case "ordering":
    case "cloze":
    case "typed_response":
      return activity.answerKey !== undefined;
    case "listening":
    case "formative_check":
      return (activity.configuration.items ?? []).every((item) => item.answerKey !== undefined);
    case "writing":
      return activity.rubric !== undefined;
    case "explanation":
      return true;
    default:
      return false;
  }
}

function objectiveWeightsOk(activity: ActivityView): boolean {
  return sumWeights(activity.objectives.map((o) => o.weight)) === 10_000;
}

/**
 * Detect cycles in unit prerequisites using directed edges unit → prereq.
 * Returns true when the graph is a DAG.
 */
export function prerequisitesAreAcyclic(
  units: readonly UnitAuthoring[],
): { ok: true } | { ok: false; cycleHint: string } {
  const ids = new Set(units.map((u) => versionKey(u.unitKey, u.version)));
  const edges = new Map<string, string[]>();
  for (const unit of units) {
    const from = versionKey(unit.unitKey, unit.version);
    edges.set(
      from,
      unit.prerequisites.map((p) => versionKey(p.unitKey, p.unitVersion)),
    );
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (node: string): string | null => {
    if (visited.has(node)) {
      return null;
    }
    if (visiting.has(node)) {
      return node;
    }
    visiting.add(node);
    for (const next of edges.get(node) ?? []) {
      if (!ids.has(next)) {
        continue;
      }
      const cycle = visit(next);
      if (cycle !== null) {
        return `${node} → ${cycle}`;
      }
    }
    visiting.delete(node);
    visited.add(node);
    return null;
  };

  for (const id of ids) {
    const cycle = visit(id);
    if (cycle !== null) {
      return { ok: false, cycleHint: cycle };
    }
  }
  return { ok: true };
}

/**
 * Run Database.md §7 / MVP G1 release inventory rules against a loaded package.
 */
export function validateReleaseInventory(loaded: LoadedRelease): InventoryResult {
  const issues: InventoryIssue[] = [];
  const add = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };

  const descriptorIndex = new Map(
    loaded.descriptors.map((d) => [versionKey(d.descriptorKey, d.version), d]),
  );
  const objectiveIndex = new Map(
    loaded.objectives.map((o) => [versionKey(o.objectiveKey, o.version), o]),
  );
  const moduleIndex = new Map(
    loaded.modules.map((m) => [versionKey(m.moduleKey, m.version), m]),
  );
  const unitIndex = new Map(loaded.units.map((u) => [versionKey(u.unitKey, u.version), u]));

  for (const pin of loaded.release.modules) {
    const mod = moduleIndex.get(versionKey(pin.moduleKey, pin.moduleVersion));
    if (mod === undefined) {
      add(
        "missing_module",
        `release.modules[${pin.ordinal}]`,
        `module ${pin.moduleKey}@${pin.moduleVersion} not found in package`,
      );
      continue;
    }
    if (mod.units.length !== REQUIRED_UNITS_PER_MODULE) {
      add(
        "unit_count",
        `module.${mod.moduleKey}`,
        `launch modules require exactly ${REQUIRED_UNITS_PER_MODULE} units, found ${mod.units.length}`,
      );
    }
    for (const unitPin of mod.units) {
      const unit = unitIndex.get(versionKey(unitPin.unitKey, unitPin.unitVersion));
      if (unit === undefined) {
        add(
          "missing_unit",
          `module.${mod.moduleKey}.units[${unitPin.ordinal}]`,
          `unit ${unitPin.unitKey}@${unitPin.unitVersion} not found`,
        );
        continue;
      }
      if (unit.moduleKey !== mod.moduleKey) {
        add(
          "module_key_mismatch",
          `unit.${unit.unitKey}`,
          `unit moduleKey ${unit.moduleKey} does not match module ${mod.moduleKey}`,
        );
      }
      if (unit.ordinal !== unitPin.ordinal) {
        add(
          "ordinal_mismatch",
          `unit.${unit.unitKey}`,
          `unit ordinal ${unit.ordinal} does not match module pin ${unitPin.ordinal}`,
        );
      }
      validateUnit(unit, objectiveIndex, descriptorIndex, unitIndex, add);
    }
  }

  const cycle = prerequisitesAreAcyclic(loaded.units);
  if (!cycle.ok) {
    add("prerequisite_cycle", "units.prerequisites", `cyclic prerequisites: ${cycle.cycleHint}`);
  }

  for (const objective of loaded.objectives) {
    for (const link of objective.descriptors) {
      const key = versionKey(link.descriptorKey, link.descriptorVersion);
      if (!descriptorIndex.has(key)) {
        add(
          "missing_descriptor",
          `objective.${objective.objectiveKey}`,
          `CEFR descriptor ${key} not found in package`,
        );
      }
    }
  }

  const allActivities = loaded.units.flatMap((u) =>
    activitiesOfUnit(u).map((activity) => ({ activity })),
  );
  const assetRefs = collectAssetReferences(allActivities);
  const assetResult = validateAssetFiles(loaded.releaseDir, assetRefs);
  for (const issue of assetResult.issues) {
    add("asset", issue.path, issue.message);
  }

  const copyHits = findProhibitedCertificationCopy({
    release: loaded.release,
    descriptors: loaded.descriptors,
    objectives: loaded.objectives,
    modules: loaded.modules,
    units: loaded.units,
  });
  for (const hit of copyHits) {
    add("prohibited_copy", hit.path, `banned phrase "${hit.phrase}" in: ${hit.excerpt}`);
  }

  return { ok: issues.length === 0, issues };
}

function validateUnit(
  unit: UnitAuthoring,
  objectiveIndex: Map<string, ObjectiveAuthoring>,
  descriptorIndex: Map<string, CefrDescriptorAuthoring>,
  unitIndex: Map<string, UnitAuthoring>,
  add: (code: string, path: string, message: string) => void,
): void {
  const path = `unit.${unit.unitKey}`;

  if (unit.objectives.length === 0) {
    add("objectives", path, "unit requires at least one CEFR-linked objective");
  }
  for (const link of unit.objectives) {
    const obj = objectiveIndex.get(versionKey(link.objectiveKey, link.objectiveVersion));
    if (obj === undefined) {
      add(
        "missing_objective",
        path,
        `objective ${link.objectiveKey}@${link.objectiveVersion} not found`,
      );
      continue;
    }
    for (const d of obj.descriptors) {
      if (!descriptorIndex.has(versionKey(d.descriptorKey, d.descriptorVersion))) {
        add(
          "missing_descriptor",
          path,
          `descriptor ${d.descriptorKey}@${d.descriptorVersion} missing for objective ${obj.objectiveKey}`,
        );
      }
    }
  }

  for (const prereq of unit.prerequisites) {
    const key = versionKey(prereq.unitKey, prereq.unitVersion);
    if (!unitIndex.has(key)) {
      add("missing_prerequisite", path, `prerequisite unit ${key} not found in package`);
    }
  }

  const activities = activitiesOfUnit(unit);
  let deterministic = 0;
  let listening = 0;
  let writing = 0;
  let formative = 0;

  for (const activity of activities) {
    deterministic += countDeterministicInteractions(activity);
    if (activity.type === "listening") {
      listening += 1;
      if (activity.transcriptPolicy === null || activity.transcriptPolicy === undefined) {
        add(
          "transcript_policy",
          `${path}.${activity.activityKey}`,
          "listening requires transcriptPolicy",
        );
      }
      if (!activity.assets.some((a) => a.purpose === "audio")) {
        add(
          "listening_audio",
          `${path}.${activity.activityKey}`,
          "listening requires an audio asset",
        );
      }
    }
    if (activity.type === "writing") {
      writing += 1;
      if (activity.rubric === undefined) {
        add("rubric", `${path}.${activity.activityKey}`, "writing requires a rubric");
      }
    }
    if (activity.type === "formative_check") {
      formative += 1;
    }
    if (!hasAnswerCoverage(activity)) {
      add(
        "answer_coverage",
        `${path}.${activity.activityKey}`,
        "missing answer key or rubric coverage",
      );
    }
    if (!objectiveWeightsOk(activity)) {
      add(
        "objective_weights",
        `${path}.${activity.activityKey}`,
        "activity objective weights must sum to 1.0000",
      );
    }
  }

  if (deterministic < MIN_DETERMINISTIC_INTERACTIONS) {
    add(
      "deterministic_count",
      path,
      `requires ≥${MIN_DETERMINISTIC_INTERACTIONS} deterministic interactions, found ${deterministic}`,
    );
  }
  if (listening < 1) {
    add("listening", path, "unit requires at least one listening activity");
  }
  if (writing < 1) {
    add("writing", path, "unit requires at least one writing activity");
  }
  if (formative < 1) {
    add("formative_check", path, "unit requires at least one formative_check activity");
  }

  const hasExplanation = unit.lessons.some(
    (l) => l.lesson.explanation.blocks.length > 0 && l.lesson.examples.blocks.length > 0,
  );
  if (!hasExplanation) {
    add("explanation_examples", path, "unit lessons require explanation and examples");
  }
}
