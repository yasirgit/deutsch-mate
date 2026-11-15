/**
 * Review scheduling types for review.v1 (DM-039 / FR-030).
 */

export type ReviewSkill = "vocabulary" | "grammar";

export type EvidenceValidity = "valid" | "invalid" | "unverified";

export type ReviewItemState = "due" | "scheduled" | "completed" | "suspended";

export type ActiveReviewState = "due" | "scheduled";

/** Append-only evidence fact used as algorithm input (valid rows only). */
export interface ReviewEvidenceInput {
  readonly evidenceId: string;
  readonly userId: string;
  readonly attemptId: string;
  readonly objectiveVersionId: string;
  /** Objective skill from content.objective_versions.skill */
  readonly skill: string;
  readonly scoreRatio: number | null;
  readonly validity: EvidenceValidity;
  readonly observedAt: Date;
}

export interface ReviewScheduleResult {
  readonly algorithmVersion: string;
  readonly dueAt: Date;
  readonly intervalDays: number;
  readonly ease: number;
  readonly state: ActiveReviewState;
  readonly sourceAttemptId: string;
  readonly objectiveVersionId: string;
  readonly lastEvidenceId: string;
  readonly userId: string;
}

export interface ReviewQueueItem extends ReviewScheduleResult {
  /** Stable sort key; caller may use evidence or review id. */
  readonly sortKey: string;
}

export interface PriorReviewState {
  readonly intervalDays: number;
  readonly ease: number;
  /** Successful review repetitions completed (SM-2 n). */
  readonly repetition: number;
}
