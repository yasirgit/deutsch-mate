/**
 * Pure deterministic scoring algorithms (DM-038).
 * Framework, provider, and transport imports are forbidden here.
 */

export {
  DETERMINISTIC_ALGORITHM_VERSION,
  scoreAnswerSpec,
} from "./deterministic-v1.js";
export { parseLearnerResponse } from "./parse-response.js";
export {
  caseFold,
  collapseWhitespace,
  matchText,
  normalizeAnswer,
} from "./normalize.js";
export type {
  AnswerSpec,
  CaseFoldedAnswerSpec,
  ClozeAnswerSpec,
  ClozeBlankAccept,
  DeterministicScoreResult,
  ExactAnswerSpec,
  LearnerResponse,
  MatchingAnswerSpec,
  NormalizedAnswerSpec,
  OrderedAnswerSpec,
  ScoreDetails,
  SetAnswerSpec,
  WeightedAlternativesAnswerSpec,
} from "./types.js";

export const SCORING_PACKAGE_NAME = "@deutsch-mate/scoring";
