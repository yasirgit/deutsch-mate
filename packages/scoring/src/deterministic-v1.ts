/**
 * deterministic.v1 — score learner responses against AnswerSpec kinds.
 */

import { matchText } from "./normalize.js";
import {
  DETERMINISTIC_ALGORITHM_VERSION,
  type AnswerSpec,
  type ClozeBlankAccept,
  type DeterministicScoreResult,
  type LearnerResponse,
  type ScoreDetails,
  type WeightedAlternativesAnswerSpec,
} from "./types.js";

const SCORE_EPSILON = 1e-9;

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function parseWeight(weight: string): number {
  const n = Number(weight);
  if (!Number.isFinite(n) || n <= 0 || n > 1) {
    throw new Error(`Invalid alternative weight: ${weight}`);
  }
  return n;
}

function asText(response: LearnerResponse): string | null {
  if (response.kind === "text") {
    return response.text;
  }
  return null;
}

function scoreWeighted(
  spec: WeightedAlternativesAnswerSpec,
  actual: string,
): { readonly matched: boolean; readonly scoreRatio: number } {
  let best = 0;
  for (const alt of spec.alternatives) {
    if (matchText(actual, alt.value, alt.match)) {
      best = Math.max(best, parseWeight(alt.weight));
    }
  }
  return { matched: best > 0, scoreRatio: best };
}

function scoreBlankAccept(
  accept: ClozeBlankAccept,
  actual: string,
): { readonly matched: boolean; readonly scoreRatio: number } {
  switch (accept.kind) {
    case "exact":
    case "case_folded":
    case "normalized": {
      const matched = matchText(
        actual,
        accept.value,
        accept.kind === "exact"
          ? "exact"
          : accept.kind === "case_folded"
            ? "case_folded"
            : "normalized",
      );
      return { matched, scoreRatio: matched ? 1 : 0 };
    }
    case "weighted_alternatives":
      return scoreWeighted(accept, actual);
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function pairKey(leftId: string, rightId: string): string {
  return `${leftId}\0${rightId}`;
}

function samePairs(
  a: readonly { readonly leftId: string; readonly rightId: string }[],
  b: readonly { readonly leftId: string; readonly rightId: string }[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const left = new Set(a.map((p) => pairKey(p.leftId, p.rightId)));
  const right = new Set(b.map((p) => pairKey(p.leftId, p.rightId)));
  if (left.size !== right.size) {
    return false;
  }
  for (const key of left) {
    if (!right.has(key)) {
      return false;
    }
  }
  return true;
}

function finish(
  kind: AnswerSpec["kind"],
  maxScore: number,
  scoreRatio: number,
  extras: Partial<ScoreDetails> = {},
): DeterministicScoreResult {
  const clamped = Math.min(1, Math.max(0, scoreRatio));
  const score = roundScore(maxScore * clamped);
  const passed = score + SCORE_EPSILON >= maxScore;
  const details: ScoreDetails = {
    kind,
    matched: clamped > 0,
    scoreRatio: roundScore(clamped),
    ...extras,
  };
  return {
    algorithmVersion: DETERMINISTIC_ALGORITHM_VERSION,
    score,
    maxScore: roundScore(maxScore),
    passed,
    details,
  };
}

/**
 * Score a learner response against an AnswerSpec using deterministic.v1.
 * @throws if maxScore is invalid
 */
export function scoreAnswerSpec(
  spec: AnswerSpec,
  response: LearnerResponse,
  maxScore: number,
): DeterministicScoreResult {
  if (!Number.isFinite(maxScore) || maxScore < 0) {
    throw new Error("maxScore must be a non-negative finite number.");
  }

  switch (spec.kind) {
    case "exact":
    case "case_folded":
    case "normalized": {
      const text = asText(response);
      if (text === null) {
        return finish(spec.kind, maxScore, 0, { notes: ["expected_text_response"] });
      }
      const mode =
        spec.kind === "exact"
          ? "exact"
          : spec.kind === "case_folded"
            ? "case_folded"
            : "normalized";
      const matched = matchText(text, spec.value, mode);
      return finish(spec.kind, maxScore, matched ? 1 : 0);
    }
    case "weighted_alternatives": {
      const text = asText(response);
      if (text === null) {
        return finish(spec.kind, maxScore, 0, { notes: ["expected_text_response"] });
      }
      const result = scoreWeighted(spec, text);
      return finish(spec.kind, maxScore, result.scoreRatio);
    }
    case "set": {
      if (response.kind !== "selected") {
        return finish(spec.kind, maxScore, 0, { notes: ["expected_selected_response"] });
      }
      const matched = sameSet(response.selected, spec.values);
      return finish(spec.kind, maxScore, matched ? 1 : 0);
    }
    case "ordered": {
      if (response.kind !== "order") {
        return finish(spec.kind, maxScore, 0, { notes: ["expected_order_response"] });
      }
      const matched = sameOrder(response.order, spec.order);
      return finish(spec.kind, maxScore, matched ? 1 : 0);
    }
    case "matching": {
      if (response.kind !== "pairs") {
        return finish(spec.kind, maxScore, 0, { notes: ["expected_pairs_response"] });
      }
      const matched = samePairs(response.pairs, spec.pairs);
      return finish(spec.kind, maxScore, matched ? 1 : 0);
    }
    case "cloze": {
      if (response.kind !== "blanks") {
        return finish(spec.kind, maxScore, 0, { notes: ["expected_blanks_response"] });
      }
      if (spec.blanks.length === 0) {
        return finish(spec.kind, maxScore, 0, { notes: ["empty_cloze_spec"] });
      }
      const blankResults: Record<string, { matched: boolean; scoreRatio: number }> = {};
      let sum = 0;
      for (const blank of spec.blanks) {
        const actual = response.blanks[blank.blankId] ?? "";
        const result = scoreBlankAccept(blank.accept, actual);
        blankResults[blank.blankId] = result;
        sum += result.scoreRatio;
      }
      const scoreRatio = sum / spec.blanks.length;
      return finish(spec.kind, maxScore, scoreRatio, { blankResults });
    }
  }
}

export { DETERMINISTIC_ALGORITHM_VERSION };
