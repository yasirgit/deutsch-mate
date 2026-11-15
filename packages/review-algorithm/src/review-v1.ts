/**
 * review.v1 — deterministic, bounded due-review scheduling (FR-030).
 *
 * ## Eligibility (valid evidence only)
 * - Invalid / unverified evidence is never scheduled.
 * - Vocabulary and grammar objectives always schedule from valid evidence.
 * - Other skills schedule only as eligible mistakes:
 *   score_ratio is present and score_ratio < ELIGIBLE_MISTAKE_MAX_SCORE_RATIO (0.7).
 *
 * ## Scheduling (SM-2–inspired, pinned constants)
 * - Quality q ∈ {0..5} derived from score_ratio bands.
 * - Ease starts at INITIAL_EASE (2.5); min MIN_EASE (1.3).
 * - q < 3 (failure / low score): interval_days = 0 → due immediately at observed_at.
 * - First success (repetition 0): interval_days = 1.
 * - Second success: interval_days = 6.
 * - Later: interval_days = round(prevInterval * ease), minimum 1.
 * - due_at = observed_at + interval_days days (UTC ms arithmetic).
 * - state = due_at <= asOf ? 'due' : 'scheduled'.
 *
 * ## Queue bound
 * At most MAX_ACTIVE_REVIEW_ITEMS (50) items in due|scheduled per user.
 * Stable order: due_at ASC, objectiveVersionId ASC, sortKey ASC.
 * Excess become suspended (caller persists that state).
 */

import type {
  ActiveReviewState,
  PriorReviewState,
  ReviewEvidenceInput,
  ReviewQueueItem,
  ReviewScheduleResult,
} from "./types.js";

export const REVIEW_ALGORITHM_VERSION = "review.v1";

/** Maximum due+scheduled items retained per learner. */
export const MAX_ACTIVE_REVIEW_ITEMS = 50;

/**
 * Mistakes eligible for review when skill is not vocabulary/grammar:
 * score_ratio strictly below this threshold.
 */
export const ELIGIBLE_MISTAKE_MAX_SCORE_RATIO = 0.7;

export const REVIEW_SKILLS = ["vocabulary", "grammar"] as const;

export const INITIAL_EASE = 2.5;
export const MIN_EASE = 1.3;

const MS_PER_DAY = 86_400_000;

const REVIEW_SKILL_SET: ReadonlySet<string> = new Set(REVIEW_SKILLS);

/**
 * Maps score_ratio to SM-2 quality 0–5.
 * Bands: [0,0.2)→0, [0.2,0.4)→1, [0.4,0.6)→2, [0.6,0.8)→3, [0.8,1)→4, 1→5.
 */
export function qualityFromScoreRatio(scoreRatio: number): number {
  const r = clampRatio(scoreRatio);
  if (r < 0.2) return 0;
  if (r < 0.4) return 1;
  if (r < 0.6) return 2;
  if (r < 0.8) return 3;
  if (r < 1) return 4;
  return 5;
}

export function isReviewSkill(skill: string): boolean {
  return REVIEW_SKILL_SET.has(skill);
}

/**
 * Whether valid evidence should create/advance a review item.
 * Invalid/unverified always false.
 */
export function isEligibleForReview(input: {
  readonly validity: string;
  readonly skill: string;
  readonly scoreRatio: number | null;
}): boolean {
  if (input.validity !== "valid") {
    return false;
  }
  if (isReviewSkill(input.skill)) {
    return true;
  }
  if (input.scoreRatio === null) {
    return false;
  }
  return clampRatio(input.scoreRatio) < ELIGIBLE_MISTAKE_MAX_SCORE_RATIO;
}

export function updateEase(ease: number, quality: number): number {
  const q = clampInt(quality, 0, 5);
  const next = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  return roundEase(Math.max(MIN_EASE, next));
}

export function nextIntervalDays(
  quality: number,
  prior: PriorReviewState | null,
): { readonly intervalDays: number; readonly repetition: number; readonly ease: number } {
  const ease = updateEase(prior?.ease ?? INITIAL_EASE, quality);
  if (quality < 3) {
    return { intervalDays: 0, repetition: 0, ease };
  }
  const repetition = (prior?.repetition ?? 0) + 1;
  if (repetition === 1) {
    return { intervalDays: 1, repetition, ease };
  }
  if (repetition === 2) {
    return { intervalDays: 6, repetition, ease };
  }
  const prev = prior?.intervalDays ?? 1;
  const intervalDays = Math.max(1, Math.round(prev * ease));
  return { intervalDays, repetition, ease };
}

/**
 * Pure schedule from one evidence fact (+ optional prior for the same source attempt).
 * Same inputs always yield the same due_at / interval / ease / state for a given asOf.
 */
export function scheduleFromEvidence(
  evidence: ReviewEvidenceInput,
  asOf: Date,
  prior: PriorReviewState | null = null,
): ReviewScheduleResult | null {
  if (
    !isEligibleForReview({
      validity: evidence.validity,
      skill: evidence.skill,
      scoreRatio: evidence.scoreRatio,
    })
  ) {
    return null;
  }
  if (evidence.scoreRatio === null) {
    return null;
  }

  const quality = qualityFromScoreRatio(evidence.scoreRatio);
  const { intervalDays, ease } = nextIntervalDays(quality, prior);
  const dueAt = addDays(evidence.observedAt, intervalDays);
  const state: ActiveReviewState = dueAt.getTime() <= asOf.getTime() ? "due" : "scheduled";

  return {
    algorithmVersion: REVIEW_ALGORITHM_VERSION,
    dueAt,
    intervalDays: roundInterval(intervalDays),
    ease,
    state,
    sourceAttemptId: evidence.attemptId,
    objectiveVersionId: evidence.objectiveVersionId,
    lastEvidenceId: evidence.evidenceId,
    userId: evidence.userId,
  };
}

/**
 * Rebuild active queue candidates from ordered valid evidence history.
 * Each (user, objective, source_attempt) keeps the latest eligible schedule.
 * Then applies the stable bound; excess are marked suspended by the caller.
 */
export function projectReviewQueue(
  evidenceHistory: readonly ReviewEvidenceInput[],
  asOf: Date,
): {
  readonly active: readonly ReviewQueueItem[];
  readonly suspended: readonly ReviewQueueItem[];
} {
  const byKey = new Map<string, ReviewQueueItem>();

  for (const evidence of evidenceHistory) {
    if (evidence.validity !== "valid") {
      continue;
    }
    const scheduled = scheduleFromEvidence(evidence, asOf, null);
    if (!scheduled) {
      continue;
    }
    const key = `${scheduled.userId}\0${scheduled.objectiveVersionId}\0${scheduled.sourceAttemptId}`;
    byKey.set(key, {
      ...scheduled,
      sortKey: evidence.evidenceId,
    });
  }

  const sorted = [...byKey.values()].sort(compareQueueItems);
  const active = sorted.slice(0, MAX_ACTIVE_REVIEW_ITEMS);
  const suspended = sorted.slice(MAX_ACTIVE_REVIEW_ITEMS);
  return { active, suspended };
}

/**
 * After upserting new items, decide which existing active rows must become suspended.
 * `candidates` must include all due|scheduled items for the user (new + existing).
 */
export function boundActiveQueue(
  candidates: readonly ReviewQueueItem[],
): {
  readonly keep: readonly ReviewQueueItem[];
  readonly suspend: readonly ReviewQueueItem[];
} {
  const sorted = [...candidates].sort(compareQueueItems);
  return {
    keep: sorted.slice(0, MAX_ACTIVE_REVIEW_ITEMS),
    suspend: sorted.slice(MAX_ACTIVE_REVIEW_ITEMS),
  };
}

export function compareQueueItems(a: ReviewQueueItem, b: ReviewQueueItem): number {
  const due = a.dueAt.getTime() - b.dueAt.getTime();
  if (due !== 0) return due;
  const obj = a.objectiveVersionId.localeCompare(b.objectiveVersionId);
  if (obj !== 0) return obj;
  return a.sortKey.localeCompare(b.sortKey);
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * MS_PER_DAY);
}

function roundEase(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundInterval(value: number): number {
  return Math.round(value * 100) / 100;
}
