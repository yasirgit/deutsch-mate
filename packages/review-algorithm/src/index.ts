/**
 * Pure review scheduling algorithms (DM-039).
 * Framework, provider, and transport imports are forbidden here.
 */

export {
  REVIEW_ALGORITHM_VERSION,
  MAX_ACTIVE_REVIEW_ITEMS,
  ELIGIBLE_MISTAKE_MAX_SCORE_RATIO,
  REVIEW_SKILLS,
  INITIAL_EASE,
  MIN_EASE,
  qualityFromScoreRatio,
  isReviewSkill,
  isEligibleForReview,
  updateEase,
  nextIntervalDays,
  scheduleFromEvidence,
  projectReviewQueue,
  boundActiveQueue,
  compareQueueItems,
} from "./review-v1.js";
export type {
  ReviewSkill,
  EvidenceValidity,
  ReviewItemState,
  ActiveReviewState,
  ReviewEvidenceInput,
  ReviewScheduleResult,
  ReviewQueueItem,
  PriorReviewState,
} from "./types.js";

export const REVIEW_ALGORITHM_PACKAGE_NAME = "@deutsch-mate/review-algorithm";
