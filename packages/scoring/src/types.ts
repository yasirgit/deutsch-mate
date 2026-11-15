/**
 * Structural AnswerSpec kinds mirrored from `@deutsch-mate/content-schemas`
 * (domain tier cannot import shared). Keep shapes in sync with answers.ts.
 */

export type ExactAnswerSpec = { readonly kind: "exact"; readonly value: string };
export type CaseFoldedAnswerSpec = { readonly kind: "case_folded"; readonly value: string };
export type NormalizedAnswerSpec = { readonly kind: "normalized"; readonly value: string };
export type SetAnswerSpec = { readonly kind: "set"; readonly values: readonly string[] };
export type OrderedAnswerSpec = { readonly kind: "ordered"; readonly order: readonly string[] };
export type MatchingAnswerSpec = {
  readonly kind: "matching";
  readonly pairs: readonly { readonly leftId: string; readonly rightId: string }[];
};
export type WeightedAlternativesAnswerSpec = {
  readonly kind: "weighted_alternatives";
  readonly alternatives: readonly {
    readonly value: string;
    readonly weight: string;
    readonly match: "exact" | "case_folded" | "normalized";
  }[];
};
export type ClozeBlankAccept =
  | ExactAnswerSpec
  | CaseFoldedAnswerSpec
  | NormalizedAnswerSpec
  | WeightedAlternativesAnswerSpec;
export type ClozeAnswerSpec = {
  readonly kind: "cloze";
  readonly blanks: readonly {
    readonly blankId: string;
    readonly accept: ClozeBlankAccept;
  }[];
};

export type AnswerSpec =
  | ExactAnswerSpec
  | CaseFoldedAnswerSpec
  | NormalizedAnswerSpec
  | SetAnswerSpec
  | OrderedAnswerSpec
  | MatchingAnswerSpec
  | WeightedAlternativesAnswerSpec
  | ClozeAnswerSpec;

/** Learner response shapes accepted by deterministic.v1. */
export type LearnerResponse =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "selected"; readonly selected: readonly string[] }
  | { readonly kind: "order"; readonly order: readonly string[] }
  | {
      readonly kind: "pairs";
      readonly pairs: readonly { readonly leftId: string; readonly rightId: string }[];
    }
  | { readonly kind: "blanks"; readonly blanks: Readonly<Record<string, string>> }
  | { readonly kind: "empty" };

export interface ScoreDetails {
  readonly kind: AnswerSpec["kind"];
  readonly matched: boolean;
  readonly scoreRatio: number;
  readonly notes?: readonly string[];
  readonly blankResults?: Readonly<Record<string, { matched: boolean; scoreRatio: number }>>;
}

export interface DeterministicScoreResult {
  readonly algorithmVersion: typeof DETERMINISTIC_ALGORITHM_VERSION;
  readonly score: number;
  readonly maxScore: number;
  readonly passed: boolean;
  readonly details: ScoreDetails;
}

/** Pinned scoring algorithm version written on attempts/scores/evidence. */
export const DETERMINISTIC_ALGORITHM_VERSION = "deterministic.v1" as const;
