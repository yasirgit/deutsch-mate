/**
 * Structural activity view for inventory/import. Avoids fragile cross-package
 * identity on Zod-inferred discriminated unions (declaration emit + EOPT).
 */

export interface ActivityObjectiveView {
  readonly objectiveKey: string;
  readonly objectiveVersion: number;
  readonly weight: string;
}

export interface ActivityAssetView {
  readonly assetKey: string;
  readonly purpose: string;
  readonly ordinal: number;
  readonly contentType: string;
  readonly sourcePath: string;
  readonly sha256: string;
  readonly altText?: string;
  readonly transcript?: unknown;
}

export interface AnswerKeyView {
  readonly version: number;
  readonly scoringAlgorithmVersion: string;
  readonly answerSpec: unknown;
  readonly rationale?: unknown;
  readonly maxScore: string;
}

export interface RubricView {
  readonly rubricKey: string;
  readonly version: number;
  readonly dimensions: unknown;
  readonly scoringRule: unknown;
}

export interface NestedItemView {
  readonly type: string;
  readonly answerKey?: AnswerKeyView;
}

export interface ActivityView {
  readonly schemaVersion: 1;
  readonly activityKey: string;
  readonly version: number;
  readonly type: string;
  readonly level: string;
  readonly prompt: unknown;
  readonly maxScore: string;
  readonly required: boolean;
  readonly objectives: readonly ActivityObjectiveView[];
  readonly assets: readonly ActivityAssetView[];
  readonly transcriptPolicy: string | null;
  readonly configuration: { readonly items?: readonly NestedItemView[]; readonly [key: string]: unknown };
  readonly answerKey?: AnswerKeyView;
  readonly rubric?: RubricView;
}

export function asActivityView(activity: unknown): ActivityView {
  return activity as ActivityView;
}
