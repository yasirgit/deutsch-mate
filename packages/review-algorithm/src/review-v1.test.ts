import { describe, expect, it } from "vitest";

import {
  ELIGIBLE_MISTAKE_MAX_SCORE_RATIO,
  INITIAL_EASE,
  MAX_ACTIVE_REVIEW_ITEMS,
  MIN_EASE,
  REVIEW_ALGORITHM_VERSION,
  boundActiveQueue,
  isEligibleForReview,
  nextIntervalDays,
  projectReviewQueue,
  qualityFromScoreRatio,
  scheduleFromEvidence,
} from "./review-v1.js";
import type { ReviewEvidenceInput, ReviewQueueItem } from "./types.js";

const OBSERVED = new Date("2026-07-30T12:00:00.000Z");
const AS_OF = new Date("2026-07-30T12:00:00.000Z");

function evidence(
  overrides: Partial<ReviewEvidenceInput> &
    Pick<ReviewEvidenceInput, "evidenceId" | "attemptId" | "objectiveVersionId">,
): ReviewEvidenceInput {
  return {
    userId: "user-1",
    skill: "vocabulary",
    scoreRatio: 1,
    validity: "valid",
    observedAt: OBSERVED,
    ...overrides,
  };
}

describe("review.v1 eligibility", () => {
  it("rejects invalid and unverified evidence", () => {
    expect(
      isEligibleForReview({ validity: "invalid", skill: "vocabulary", scoreRatio: 1 }),
    ).toBe(false);
    expect(
      isEligibleForReview({ validity: "unverified", skill: "grammar", scoreRatio: 0 }),
    ).toBe(false);
  });

  it("accepts vocabulary and grammar valid evidence at any score", () => {
    expect(
      isEligibleForReview({ validity: "valid", skill: "vocabulary", scoreRatio: 1 }),
    ).toBe(true);
    expect(
      isEligibleForReview({ validity: "valid", skill: "grammar", scoreRatio: 0 }),
    ).toBe(true);
  });

  it("accepts non-review skills only as eligible mistakes below threshold", () => {
    expect(
      isEligibleForReview({
        validity: "valid",
        skill: "reading",
        scoreRatio: ELIGIBLE_MISTAKE_MAX_SCORE_RATIO - 0.01,
      }),
    ).toBe(true);
    expect(
      isEligibleForReview({
        validity: "valid",
        skill: "reading",
        scoreRatio: ELIGIBLE_MISTAKE_MAX_SCORE_RATIO,
      }),
    ).toBe(false);
    expect(
      isEligibleForReview({ validity: "valid", skill: "listening", scoreRatio: null }),
    ).toBe(false);
  });
});

describe("review.v1 quality and intervals", () => {
  it("maps score_ratio bands to quality 0–5", () => {
    expect(qualityFromScoreRatio(0)).toBe(0);
    expect(qualityFromScoreRatio(0.19)).toBe(0);
    expect(qualityFromScoreRatio(0.2)).toBe(1);
    expect(qualityFromScoreRatio(0.59)).toBe(2);
    expect(qualityFromScoreRatio(0.7)).toBe(3);
    expect(qualityFromScoreRatio(0.9)).toBe(4);
    expect(qualityFromScoreRatio(1)).toBe(5);
  });

  it("resets interval on failure and grows on success", () => {
    const fail = nextIntervalDays(1, { intervalDays: 6, ease: 2.5, repetition: 2 });
    expect(fail.intervalDays).toBe(0);
    expect(fail.repetition).toBe(0);
    expect(fail.ease).toBeGreaterThanOrEqual(MIN_EASE);

    const first = nextIntervalDays(5, null);
    expect(first.intervalDays).toBe(1);
    expect(first.repetition).toBe(1);
    expect(first.ease).toBeGreaterThan(INITIAL_EASE);

    const second = nextIntervalDays(5, {
      intervalDays: 1,
      ease: first.ease,
      repetition: 1,
    });
    expect(second.intervalDays).toBe(6);

    const third = nextIntervalDays(5, {
      intervalDays: 6,
      ease: second.ease,
      repetition: 2,
    });
    expect(third.intervalDays).toBe(Math.max(1, Math.round(6 * third.ease)));
  });
});

describe("review.v1 scheduleFromEvidence", () => {
  it("pins algorithm version and schedules success one day out", () => {
    const result = scheduleFromEvidence(
      evidence({
        evidenceId: "ev-1",
        attemptId: "att-1",
        objectiveVersionId: "obj-1",
        scoreRatio: 1,
      }),
      AS_OF,
    );
    expect(result).not.toBeNull();
    expect(result!.algorithmVersion).toBe(REVIEW_ALGORITHM_VERSION);
    expect(result!.intervalDays).toBe(1);
    expect(result!.dueAt.toISOString()).toBe("2026-07-31T12:00:00.000Z");
    expect(result!.state).toBe("scheduled");
    expect(result!.ease).toBeGreaterThan(INITIAL_EASE);
  });

  it("makes failed vocabulary immediately due", () => {
    const result = scheduleFromEvidence(
      evidence({
        evidenceId: "ev-2",
        attemptId: "att-2",
        objectiveVersionId: "obj-1",
        scoreRatio: 0,
      }),
      AS_OF,
    );
    expect(result!.intervalDays).toBe(0);
    expect(result!.dueAt.toISOString()).toBe(OBSERVED.toISOString());
    expect(result!.state).toBe("due");
  });

  it("ignores invalid evidence", () => {
    expect(
      scheduleFromEvidence(
        evidence({
          evidenceId: "ev-3",
          attemptId: "att-3",
          objectiveVersionId: "obj-1",
          validity: "invalid",
          scoreRatio: 0,
        }),
        AS_OF,
      ),
    ).toBeNull();
  });

  it("is deterministic for identical inputs", () => {
    const input = evidence({
      evidenceId: "ev-4",
      attemptId: "att-4",
      objectiveVersionId: "obj-g",
      skill: "grammar",
      scoreRatio: 0.85,
    });
    const a = scheduleFromEvidence(input, AS_OF);
    const b = scheduleFromEvidence(input, AS_OF);
    expect(a).toEqual(b);
  });
});

describe("review.v1 queue bound and rebuild", () => {
  it("bounds active queue with stable sort", () => {
    const items: ReviewQueueItem[] = Array.from({ length: MAX_ACTIVE_REVIEW_ITEMS + 3 }, (_, i) => {
      const pad = String(i).padStart(3, "0");
      return {
        algorithmVersion: REVIEW_ALGORITHM_VERSION,
        userId: "user-1",
        objectiveVersionId: `obj-${pad}`,
        sourceAttemptId: `att-${pad}`,
        lastEvidenceId: `ev-${pad}`,
        dueAt: new Date(OBSERVED.getTime() + i * 60_000),
        intervalDays: 1,
        ease: INITIAL_EASE,
        state: "scheduled" as const,
        sortKey: `ev-${pad}`,
      };
    });
    const { keep, suspend } = boundActiveQueue(items);
    expect(keep).toHaveLength(MAX_ACTIVE_REVIEW_ITEMS);
    expect(suspend).toHaveLength(3);
    expect(keep[0]!.objectiveVersionId).toBe("obj-000");
    expect(suspend[0]!.objectiveVersionId).toBe(`obj-${String(MAX_ACTIVE_REVIEW_ITEMS).padStart(3, "0")}`);
  });

  it("projectReviewQueue ignores invalid rows and matches scheduleFromEvidence", () => {
    const history: ReviewEvidenceInput[] = [
      evidence({
        evidenceId: "ev-a",
        attemptId: "att-a",
        objectiveVersionId: "obj-a",
        scoreRatio: 1,
      }),
      evidence({
        evidenceId: "ev-bad",
        attemptId: "att-bad",
        objectiveVersionId: "obj-a",
        validity: "unverified",
        scoreRatio: 0,
      }),
      evidence({
        evidenceId: "ev-b",
        attemptId: "att-b",
        objectiveVersionId: "obj-b",
        skill: "reading",
        scoreRatio: 0.2,
      }),
      evidence({
        evidenceId: "ev-c",
        attemptId: "att-c",
        objectiveVersionId: "obj-c",
        skill: "reading",
        scoreRatio: 0.95,
      }),
    ];
    const { active, suspended } = projectReviewQueue(history, AS_OF);
    expect(suspended).toHaveLength(0);
    expect(active.map((r) => r.sourceAttemptId).sort()).toEqual(["att-a", "att-b"]);
    const direct = scheduleFromEvidence(history[0]!, AS_OF)!;
    expect(active.find((r) => r.sourceAttemptId === "att-a")!.dueAt).toEqual(direct.dueAt);
  });
});
