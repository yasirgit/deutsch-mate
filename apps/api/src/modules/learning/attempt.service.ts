/**
 * Activity attempts + deterministic scoring transaction (DM-038/039).
 *
 * Atomic scored path (Database.md transaction #1):
 * lock session → insert attempt/response/score/feedback/evidence →
 * review_items → unit_progress → outbox. Duplicate client_attempt_id returns original (200).
 *
 * Attempt rows are never mutated after insert; API status is derived.
 *
 * Writing without a deterministic answer key: feedback_pending insertion +
 * unavailable feedback (no valid mastery evidence). AI scoring is DM-045.
 */

import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Database } from "@deutsch-mate/database";
import { insertOutboxEvent } from "@deutsch-mate/database";
import { createUuidV7 } from "@deutsch-mate/domain";
import {
  DETERMINISTIC_ALGORITHM_VERSION,
  parseLearnerResponse,
  scoreAnswerSpec,
  type AnswerSpec,
} from "@deutsch-mate/scoring";
import { sql, type Kysely, type Transaction } from "kysely";

import type { RequestActor } from "../../platform/auth/actor.js";
import { KYSELY, type KyselyToken } from "../../platform/database.tokens.js";
import { getRequestStore, requireRequestStore } from "../../platform/request-context.js";
import { ReviewService } from "./review.service.js";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EVIDENCE_REASON_DETERMINISTIC = "deterministic_score";

export type AttemptApiStatus =
  | "submitted"
  | "scored"
  | "feedback_pending"
  | "completed"
  | "feedback_unavailable";

export interface AttemptResponseInput {
  readonly responseKind: "structured" | "choice" | "text";
  readonly response?: Record<string, unknown>;
  readonly textContent?: string;
}

export interface ActivityAttemptInput {
  readonly activityVersionId: string;
  readonly clientAttemptId: string;
  readonly attemptNumber: number;
  readonly durationMs?: number | null;
  readonly response: AttemptResponseInput;
}

export interface AttemptScoreDto {
  readonly id: string;
  readonly score: string;
  readonly maxScore: string;
  readonly passed: boolean;
  readonly scoringMethod: "deterministic" | "verified_ai";
  readonly algorithmVersion: string;
  readonly details: Record<string, unknown>;
  readonly createdAt: string;
}

export interface FeedbackDto {
  readonly id: string;
  readonly feedbackKind: "deterministic" | "ai" | "unavailable";
  readonly correctedText: string | null;
  readonly feedback: Record<string, unknown>;
  readonly learnerDisposition: "accepted" | "retried" | "dismissed" | null;
  readonly contentExpiresAt: string | null;
  readonly createdAt: string;
}

export interface ActivityAttemptDto {
  readonly id: string;
  readonly sessionId: string;
  readonly activityVersionId: string;
  readonly answerKeyVersionId: string | null;
  readonly rubricVersionId: string | null;
  readonly clientAttemptId: string;
  readonly attemptNumber: number;
  readonly status: AttemptApiStatus;
  readonly submittedAt: string;
  readonly durationMs: number | null;
  readonly algorithmVersion: string;
  readonly score: AttemptScoreDto | null;
  readonly feedback: FeedbackDto | null;
  readonly createdAt: string;
}

export interface SubmitAttemptResult {
  readonly attempt: ActivityAttemptDto;
  readonly httpStatus: 200 | 201 | 202;
}

type AttemptRow = {
  id: string;
  session_id: string;
  activity_version_id: string;
  answer_key_version_id: string | null;
  rubric_version_id: string | null;
  client_attempt_id: string;
  attempt_number: number;
  status: string;
  submitted_at: Date;
  duration_ms: number | null;
  algorithm_version: string;
  created_at: Date;
};

type ScoreRow = {
  id: string;
  score: string;
  max_score: string;
  passed: boolean;
  scoring_method: string;
  algorithm_version: string;
  details: unknown;
  created_at: Date;
};

type FeedbackRow = {
  id: string;
  feedback_kind: string;
  corrected_text: string | null;
  feedback: unknown;
  learner_disposition: string | null;
  content_expires_at: Date | null;
  created_at: Date;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function assertUuidV7(value: string, label: string): void {
  if (!UUID_V7_RE.test(value)) {
    throw new BadRequestException({
      code: "validation_failed",
      detail: `${label} must be a UUIDv7.`,
    });
  }
}

function decimalString(value: number | string): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return "0.000";
  }
  return n.toFixed(3);
}

function ratioString(value: number): string {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped.toFixed(5);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asAnswerSpec(value: unknown): AnswerSpec | null {
  if (!isRecord(value) || typeof value["kind"] !== "string") {
    return null;
  }
  return value as AnswerSpec;
}

function sha256Payload(parts: {
  readonly responseKind: string;
  readonly response: unknown;
  readonly textContent: string | null;
}): string {
  const material = JSON.stringify({
    responseKind: parts.responseKind,
    response: parts.response,
    textContent: parts.textContent,
  });
  return createHash("sha256").update(material, "utf8").digest("hex");
}

function deriveApiStatus(
  insertionStatus: string,
  score: ScoreRow | null,
  feedback: FeedbackRow | null,
): AttemptApiStatus {
  if (feedback?.feedback_kind === "unavailable") {
    return "feedback_unavailable";
  }
  if (score !== null && feedback !== null) {
    return "completed";
  }
  if (score !== null) {
    return "scored";
  }
  if (insertionStatus === "feedback_pending" || feedback?.feedback_kind === "ai") {
    return "feedback_pending";
  }
  if (
    insertionStatus === "submitted" ||
    insertionStatus === "scored" ||
    insertionStatus === "completed" ||
    insertionStatus === "feedback_pending" ||
    insertionStatus === "feedback_unavailable"
  ) {
    return insertionStatus;
  }
  return "submitted";
}

function toScoreDto(row: ScoreRow): AttemptScoreDto {
  return {
    id: row.id,
    score: decimalString(row.score),
    maxScore: decimalString(row.max_score),
    passed: row.passed,
    scoringMethod: row.scoring_method === "verified_ai" ? "verified_ai" : "deterministic",
    algorithmVersion: row.algorithm_version,
    details: isRecord(row.details) ? row.details : {},
    createdAt: toIso(row.created_at),
  };
}

function toFeedbackDto(row: FeedbackRow): FeedbackDto {
  const kind =
    row.feedback_kind === "ai"
      ? "ai"
      : row.feedback_kind === "unavailable"
        ? "unavailable"
        : "deterministic";
  const disposition =
    row.learner_disposition === "accepted" ||
    row.learner_disposition === "retried" ||
    row.learner_disposition === "dismissed"
      ? row.learner_disposition
      : null;
  return {
    id: row.id,
    feedbackKind: kind,
    correctedText: row.corrected_text,
    feedback: isRecord(row.feedback) ? row.feedback : {},
    learnerDisposition: disposition,
    contentExpiresAt:
      row.content_expires_at === null ? null : toIso(row.content_expires_at),
    createdAt: toIso(row.created_at),
  };
}

function toAttemptDto(
  attempt: AttemptRow,
  score: ScoreRow | null,
  feedback: FeedbackRow | null,
): ActivityAttemptDto {
  return {
    id: attempt.id,
    sessionId: attempt.session_id,
    activityVersionId: attempt.activity_version_id,
    answerKeyVersionId: attempt.answer_key_version_id,
    rubricVersionId: attempt.rubric_version_id,
    clientAttemptId: attempt.client_attempt_id,
    attemptNumber: attempt.attempt_number,
    status: deriveApiStatus(attempt.status, score, feedback),
    submittedAt: toIso(attempt.submitted_at),
    durationMs: attempt.duration_ms,
    algorithmVersion: attempt.algorithm_version,
    score: score === null ? null : toScoreDto(score),
    feedback: feedback === null ? null : toFeedbackDto(feedback),
    createdAt: toIso(attempt.created_at),
  };
}

function extractEmbeddedAnswerKey(configuration: unknown): {
  readonly answerSpec: AnswerSpec;
  readonly maxScore: number;
} | null {
  if (!isRecord(configuration) || !Array.isArray(configuration["items"])) {
    return null;
  }
  for (const item of configuration["items"]) {
    if (!isRecord(item) || !isRecord(item["answerKey"])) {
      continue;
    }
    const key = item["answerKey"];
    const spec = asAnswerSpec(key["answerSpec"]);
    if (spec === null) {
      continue;
    }
    const maxScore = Number(key["maxScore"] ?? 1);
    return { answerSpec: spec, maxScore: Number.isFinite(maxScore) ? maxScore : 1 };
  }
  return null;
}

@Injectable()
export class AttemptService {
  constructor(
    @Optional() @Inject(KYSELY) private readonly db: KyselyToken | null,
    private readonly reviews: ReviewService,
  ) {}

  private requireDb(): Kysely<Database> {
    if (!this.db) {
      throw new Error("AttemptService requires DATABASE_URL.");
    }
    return this.db;
  }

  private correlationId(): string {
    return requireRequestStore().requestId;
  }

  private async withApiRole<T>(
    userId: string,
    fn: (executor: Kysely<Database> | Transaction<Database>) => Promise<T>,
  ): Promise<T> {
    const store = getRequestStore();
    if (store?.trx) {
      return fn(store.trx);
    }
    return this.requireDb()
      .transaction()
      .execute(async (trx) => {
        await sql`SET LOCAL ROLE dm_api`.execute(trx);
        await sql`SELECT set_config('app.user_id', ${userId}, true)`.execute(trx);
        const roles = store?.actor?.roles?.join(",") ?? "learner";
        await sql`SELECT set_config('app.roles', ${roles}, true)`.execute(trx);
        await sql`SELECT set_config('app.correlation_id', ${this.correlationId()}, true)`.execute(
          trx,
        );
        return fn(trx);
      });
  }

  async getAttempt(actor: RequestActor, attemptId: string): Promise<ActivityAttemptDto> {
    assertUuidV7(attemptId, "attemptId");
    return this.withApiRole(actor.userId, async (executor) => {
      const loaded = await this.loadAttemptBundle(executor, actor.userId, attemptId);
      if (!loaded) {
        throw new NotFoundException({
          code: "not_found",
          detail: "Activity attempt was not found.",
        });
      }
      return toAttemptDto(loaded.attempt, loaded.score, loaded.feedback);
    });
  }

  async submitAttempt(
    actor: RequestActor,
    sessionId: string,
    input: ActivityAttemptInput,
  ): Promise<SubmitAttemptResult> {
    assertUuidV7(sessionId, "sessionId");
    assertUuidV7(input.activityVersionId, "activityVersionId");
    assertUuidV7(input.clientAttemptId, "clientAttemptId");
    if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "attemptNumber must be an integer >= 1.",
      });
    }

    return this.withApiRole(actor.userId, async (executor) => {
      const existing = await this.findByClientAttemptId(
        executor,
        actor.userId,
        input.clientAttemptId,
      );
      if (existing) {
        return { attempt: existing, httpStatus: 200 };
      }

      const locked = await sql<{
        id: string;
        status: string;
        unit_version_id: string;
        lesson_version_id: string | null;
        lock_version: number;
      }>`
        SELECT id, status::text AS status, unit_version_id, lesson_version_id, lock_version
        FROM learning.sessions
        WHERE id = ${sessionId}::uuid
          AND user_id = ${actor.userId}::uuid
        FOR UPDATE
      `.execute(executor);

      const session = locked.rows[0];
      if (!session) {
        throw new NotFoundException({
          code: "not_found",
          detail: "Learning session was not found.",
        });
      }
      if (session.status !== "active") {
        throw new ConflictException({
          code: "conflict",
          detail: "Attempts can only be submitted to an active session.",
        });
      }

      const activity = await this.loadActivityInSession(
        executor,
        input.activityVersionId,
        session.unit_version_id,
        session.lesson_version_id,
      );
      if (!activity) {
        throw new NotFoundException({
          code: "not_found",
          detail: "Activity was not found in this session's unit.",
        });
      }

      const answerKey = await this.loadAnswerKey(executor, activity.id);
      const writingWithoutKey = activity.type === "writing" && answerKey === null;

      if (writingWithoutKey) {
        return this.insertWritingPending(executor, {
          actor,
          sessionId,
          activity,
          input,
        });
      }

      const scoredSpec = this.resolveAnswerSpec(activity, answerKey);
      if (scoredSpec === null) {
        throw new UnprocessableEntityException({
          code: "unprocessable",
          detail:
            "Activity has no deterministic answer key. Writing uses the AI feedback path (DM-045).",
        });
      }

      return this.insertDeterministicScored(executor, {
        actor,
        sessionId,
        unitVersionId: session.unit_version_id,
        activity,
        answerKeyVersionId: answerKey?.id ?? null,
        scoredSpec,
        input,
      });
    });
  }

  private resolveAnswerSpec(
    activity: { readonly type: string; readonly configuration: unknown; readonly max_score: string },
    answerKey: { readonly answer_spec: unknown; readonly max_score: string } | null,
  ): { readonly answerSpec: AnswerSpec; readonly maxScore: number } | null {
    if (answerKey !== null) {
      const answerSpec = asAnswerSpec(answerKey.answer_spec);
      if (answerSpec === null) {
        return null;
      }
      return { answerSpec, maxScore: Number(answerKey.max_score) };
    }
    if (activity.type === "listening" || activity.type === "formative_check") {
      const embedded = extractEmbeddedAnswerKey(activity.configuration);
      if (embedded !== null) {
        return embedded;
      }
    }
    return null;
  }

  private async insertWritingPending(
    executor: Kysely<Database> | Transaction<Database>,
    args: {
      readonly actor: RequestActor;
      readonly sessionId: string;
      readonly activity: { readonly id: string; readonly type: string };
      readonly input: ActivityAttemptInput;
    },
  ): Promise<SubmitAttemptResult> {
    const now = new Date();
    const attemptId = createUuidV7();
    const responseId = createUuidV7();
    const feedbackId = createUuidV7();
    const { responseKind, responseJson, textContent, digest } = this.normalizeResponse(
      args.input.response,
    );

    try {
      await sql`
        INSERT INTO learning.activity_attempts (
          id, user_id, session_id, activity_version_id, answer_key_version_id,
          rubric_version_id, attempt_number, client_attempt_id, status, submitted_at,
          duration_ms, algorithm_version, correlation_id, created_at
        ) VALUES (
          ${attemptId}::uuid,
          ${args.actor.userId}::uuid,
          ${args.sessionId}::uuid,
          ${args.activity.id}::uuid,
          NULL,
          NULL,
          ${args.input.attemptNumber},
          ${args.input.clientAttemptId}::uuid,
          'feedback_pending'::learning.attempt_status,
          ${now.toISOString()}::timestamptz,
          ${args.input.durationMs ?? null},
          ${DETERMINISTIC_ALGORITHM_VERSION},
          ${this.correlationId()}::uuid,
          ${now.toISOString()}::timestamptz
        )
      `.execute(executor);
    } catch (error) {
      return this.rethrowOrReplayDuplicate(executor, args.actor.userId, args.input, error);
    }

    await sql`
      INSERT INTO learning.attempt_responses (
        id, attempt_id, response_kind, response, text_content, sha256, created_at
      ) VALUES (
        ${responseId}::uuid,
        ${attemptId}::uuid,
        ${responseKind},
        ${responseJson}::jsonb,
        ${textContent},
        ${digest},
        ${now.toISOString()}::timestamptz
      )
    `.execute(executor);

    await sql`
      INSERT INTO learning.feedback_records (
        id, attempt_id, ai_run_id, feedback_kind, corrected_text, feedback,
        learner_disposition, content_expires_at, created_at
      ) VALUES (
        ${feedbackId}::uuid,
        ${attemptId}::uuid,
        NULL,
        'unavailable',
        NULL,
        ${JSON.stringify({
          reason: "writing_ai_path_deferred",
          note: "Writing feedback is produced by DM-045; no valid mastery evidence created.",
        })}::jsonb,
        NULL,
        NULL,
        ${now.toISOString()}::timestamptz
      )
    `.execute(executor);

    // No valid evidence for writing without verified AI (DM-045).
    await this.touchSession(executor, args.sessionId, now);

    const loaded = await this.loadAttemptBundle(executor, args.actor.userId, attemptId);
    if (!loaded) {
      throw new Error("failed to load writing attempt after insert");
    }
    return { attempt: toAttemptDto(loaded.attempt, loaded.score, loaded.feedback), httpStatus: 202 };
  }

  private async insertDeterministicScored(
    executor: Kysely<Database> | Transaction<Database>,
    args: {
      readonly actor: RequestActor;
      readonly sessionId: string;
      readonly unitVersionId: string;
      readonly activity: {
        readonly id: string;
        readonly type: string;
        readonly required: boolean;
        readonly max_score: string;
      };
      readonly answerKeyVersionId: string | null;
      readonly scoredSpec: { readonly answerSpec: AnswerSpec; readonly maxScore: number };
      readonly input: ActivityAttemptInput;
    },
  ): Promise<SubmitAttemptResult> {
    const now = new Date();
    const attemptId = createUuidV7();
    const responseId = createUuidV7();
    const scoreId = createUuidV7();
    const feedbackId = createUuidV7();
    const { responseKind, responseJson, textContent, digest } = this.normalizeResponse(
      args.input.response,
    );

    const learnerResponse = parseLearnerResponse({
      responseKind,
      response: responseJson === null ? undefined : JSON.parse(responseJson),
      textContent,
    });
    const scored = scoreAnswerSpec(
      args.scoredSpec.answerSpec,
      learnerResponse,
      args.scoredSpec.maxScore,
    );

    try {
      await sql`
        INSERT INTO learning.activity_attempts (
          id, user_id, session_id, activity_version_id, answer_key_version_id,
          rubric_version_id, attempt_number, client_attempt_id, status, submitted_at,
          duration_ms, algorithm_version, correlation_id, created_at
        ) VALUES (
          ${attemptId}::uuid,
          ${args.actor.userId}::uuid,
          ${args.sessionId}::uuid,
          ${args.activity.id}::uuid,
          ${args.answerKeyVersionId}::uuid,
          NULL,
          ${args.input.attemptNumber},
          ${args.input.clientAttemptId}::uuid,
          'completed'::learning.attempt_status,
          ${now.toISOString()}::timestamptz,
          ${args.input.durationMs ?? null},
          ${DETERMINISTIC_ALGORITHM_VERSION},
          ${this.correlationId()}::uuid,
          ${now.toISOString()}::timestamptz
        )
      `.execute(executor);
    } catch (error) {
      return this.rethrowOrReplayDuplicate(executor, args.actor.userId, args.input, error);
    }

    await sql`
      INSERT INTO learning.attempt_responses (
        id, attempt_id, response_kind, response, text_content, sha256, created_at
      ) VALUES (
        ${responseId}::uuid,
        ${attemptId}::uuid,
        ${responseKind},
        ${responseJson}::jsonb,
        ${textContent},
        ${digest},
        ${now.toISOString()}::timestamptz
      )
    `.execute(executor);

    await sql`
      INSERT INTO learning.attempt_scores (
        id, attempt_id, score, max_score, passed, scoring_method, algorithm_version,
        details, supersedes_score_id, created_at
      ) VALUES (
        ${scoreId}::uuid,
        ${attemptId}::uuid,
        ${decimalString(scored.score)}::numeric,
        ${decimalString(scored.maxScore)}::numeric,
        ${scored.passed},
        'deterministic',
        ${DETERMINISTIC_ALGORITHM_VERSION},
        ${JSON.stringify(scored.details)}::jsonb,
        NULL,
        ${now.toISOString()}::timestamptz
      )
    `.execute(executor);

    await sql`
      INSERT INTO learning.feedback_records (
        id, attempt_id, ai_run_id, feedback_kind, corrected_text, feedback,
        learner_disposition, content_expires_at, created_at
      ) VALUES (
        ${feedbackId}::uuid,
        ${attemptId}::uuid,
        NULL,
        'deterministic',
        NULL,
        ${JSON.stringify({
          passed: scored.passed,
          scoreRatio: scored.details.scoreRatio,
          kind: scored.details.kind,
        })}::jsonb,
        NULL,
        NULL,
        ${now.toISOString()}::timestamptz
      )
    `.execute(executor);

    const objectives = await sql<{
      objective_version_id: string;
      weight: string;
      skill: string;
    }>`
      SELECT
        ao.objective_version_id,
        ao.weight::text AS weight,
        ov.skill::text AS skill
      FROM content.activity_objectives AS ao
      JOIN content.objective_versions AS ov ON ov.id = ao.objective_version_id
      WHERE ao.activity_version_id = ${args.activity.id}::uuid
    `.execute(executor);

    const evidenceForReview: {
      evidenceId: string;
      attemptId: string;
      objectiveVersionId: string;
      skill: string;
      scoreRatio: number;
      validity: "valid";
      observedAt: Date;
    }[] = [];

    for (const objective of objectives.rows) {
      const evidenceId = createUuidV7();
      await sql`
        INSERT INTO learning.evidence (
          id, user_id, attempt_id, objective_version_id, score_ratio, validity,
          reason_code, observed_at, algorithm_version, created_at
        ) VALUES (
          ${evidenceId}::uuid,
          ${args.actor.userId}::uuid,
          ${attemptId}::uuid,
          ${objective.objective_version_id}::uuid,
          ${ratioString(scored.details.scoreRatio)}::numeric,
          'valid'::learning.evidence_validity,
          ${EVIDENCE_REASON_DETERMINISTIC},
          ${now.toISOString()}::timestamptz,
          ${DETERMINISTIC_ALGORITHM_VERSION},
          ${now.toISOString()}::timestamptz
        )
      `.execute(executor);
      evidenceForReview.push({
        evidenceId,
        attemptId,
        objectiveVersionId: objective.objective_version_id,
        skill: objective.skill,
        scoreRatio: scored.details.scoreRatio,
        validity: "valid",
        observedAt: now,
      });
    }

    await this.reviews.applyEvidenceInTransaction(
      executor,
      args.actor.userId,
      evidenceForReview,
      now,
    );

    await this.updateUnitProgress(executor, args.actor.userId, args.unitVersionId, now);
    await this.touchSession(executor, args.sessionId, now);

    await insertOutboxEvent(executor, {
      id: createUuidV7(),
      aggregateType: "activity_attempt",
      aggregateId: attemptId,
      eventType: "learning.attempt.scored.v1",
      eventVersion: 1,
      payload: {
        attemptId,
        sessionId: args.sessionId,
        userId: args.actor.userId,
        activityVersionId: args.activity.id,
        algorithmVersion: DETERMINISTIC_ALGORITHM_VERSION,
        scoringMethod: "deterministic",
        score: decimalString(scored.score),
        maxScore: decimalString(scored.maxScore),
        passed: scored.passed,
      },
      correlationId: this.correlationId(),
      occurredAt: now,
    });

    const loaded = await this.loadAttemptBundle(executor, args.actor.userId, attemptId);
    if (!loaded) {
      throw new Error("failed to load scored attempt after insert");
    }
    return { attempt: toAttemptDto(loaded.attempt, loaded.score, loaded.feedback), httpStatus: 201 };
  }

  private async updateUnitProgress(
    executor: Kysely<Database> | Transaction<Database>,
    userId: string,
    unitVersionId: string,
    now: Date,
  ): Promise<void> {
    const totals = await sql<{ required_total: number; completed_required: number }>`
      WITH required_activities AS (
        SELECT DISTINCT av.id
        FROM content.unit_lessons AS ul
        JOIN content.lesson_activities AS la ON la.lesson_version_id = ul.lesson_version_id
        JOIN content.activity_versions AS av ON av.id = la.activity_version_id
        WHERE ul.unit_version_id = ${unitVersionId}::uuid
          AND av.required = true
      ),
      completed AS (
        SELECT COUNT(DISTINCT aa.activity_version_id)::int AS n
        FROM learning.activity_attempts AS aa
        JOIN learning.attempt_scores AS s ON s.attempt_id = aa.id
        WHERE aa.user_id = ${userId}::uuid
          AND aa.activity_version_id IN (SELECT id FROM required_activities)
          AND s.supersedes_score_id IS NULL
      )
      SELECT
        (SELECT COUNT(*)::int FROM required_activities) AS required_total,
        (SELECT n FROM completed) AS completed_required
    `.execute(executor);

    const requiredTotal = totals.rows[0]?.required_total ?? 0;
    const completedRequired = totals.rows[0]?.completed_required ?? 0;
    const ratio =
      requiredTotal === 0 ? 0 : Math.min(1, completedRequired / requiredTotal);
    const completedAt =
      requiredTotal > 0 && completedRequired >= requiredTotal ? now.toISOString() : null;

    await sql`
      INSERT INTO learning.unit_progress (
        user_id, unit_version_id, completed_required, required_total, completion_ratio,
        completed_at, last_attempt_at, created_at, updated_at, lock_version
      ) VALUES (
        ${userId}::uuid,
        ${unitVersionId}::uuid,
        ${completedRequired},
        ${requiredTotal},
        ${ratioString(ratio)}::numeric,
        ${completedAt}::timestamptz,
        ${now.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz,
        1
      )
      ON CONFLICT (user_id, unit_version_id) DO UPDATE SET
        completed_required = EXCLUDED.completed_required,
        required_total = EXCLUDED.required_total,
        completion_ratio = EXCLUDED.completion_ratio,
        completed_at = EXCLUDED.completed_at,
        last_attempt_at = EXCLUDED.last_attempt_at,
        updated_at = EXCLUDED.updated_at,
        lock_version = learning.unit_progress.lock_version + 1
    `.execute(executor);
  }

  private async touchSession(
    executor: Kysely<Database> | Transaction<Database>,
    sessionId: string,
    now: Date,
  ): Promise<void> {
    await sql`
      UPDATE learning.sessions
      SET
        last_activity_at = ${now.toISOString()}::timestamptz,
        updated_at = ${now.toISOString()}::timestamptz,
        lock_version = lock_version + 1
      WHERE id = ${sessionId}::uuid
    `.execute(executor);
  }

  private normalizeResponse(input: AttemptResponseInput): {
    readonly responseKind: string;
    readonly responseJson: string | null;
    readonly textContent: string | null;
    readonly digest: string;
  } {
    if (input.responseKind === "text") {
      const textContent = input.textContent ?? "";
      if (textContent.length < 1) {
        throw new BadRequestException({
          code: "validation_failed",
          detail: "textContent is required for text responses.",
        });
      }
      return {
        responseKind: "text",
        responseJson: null,
        textContent,
        digest: sha256Payload({
          responseKind: "text",
          response: null,
          textContent,
        }),
      };
    }
    const response = input.response ?? {};
    return {
      responseKind: input.responseKind,
      responseJson: JSON.stringify(response),
      textContent: null,
      digest: sha256Payload({
        responseKind: input.responseKind,
        response,
        textContent: null,
      }),
    };
  }

  private async loadActivityInSession(
    executor: Kysely<Database> | Transaction<Database>,
    activityVersionId: string,
    unitVersionId: string,
    lessonVersionId: string | null,
  ): Promise<{
    readonly id: string;
    readonly type: string;
    readonly required: boolean;
    readonly max_score: string;
    readonly configuration: unknown;
  } | null> {
    const rows = await sql<{
      id: string;
      type: string;
      required: boolean;
      max_score: string;
      configuration: unknown;
    }>`
      SELECT
        av.id,
        av.type::text AS type,
        av.required,
        av.max_score::text AS max_score,
        av.configuration
      FROM content.v_published_activity_versions AS av
      JOIN content.lesson_activities AS la ON la.activity_version_id = av.id
      JOIN content.unit_lessons AS ul ON ul.lesson_version_id = la.lesson_version_id
      WHERE av.id = ${activityVersionId}::uuid
        AND ul.unit_version_id = ${unitVersionId}::uuid
        AND (
          ${lessonVersionId}::uuid IS NULL
          OR la.lesson_version_id = ${lessonVersionId}::uuid
        )
      LIMIT 1
    `.execute(executor);
    return rows.rows[0] ?? null;
  }

  private async loadAnswerKey(
    executor: Kysely<Database> | Transaction<Database>,
    activityVersionId: string,
  ): Promise<{
    readonly id: string;
    readonly answer_spec: unknown;
    readonly max_score: string;
    readonly scoring_algorithm_version: string;
  } | null> {
    const rows = await sql<{
      id: string;
      answer_spec: unknown;
      max_score: string;
      scoring_algorithm_version: string;
    }>`
      SELECT
        id,
        answer_spec,
        max_score::text AS max_score,
        scoring_algorithm_version
      FROM content.answer_key_versions
      WHERE activity_version_id = ${activityVersionId}::uuid
      ORDER BY version DESC
      LIMIT 1
    `.execute(executor);
    return rows.rows[0] ?? null;
  }

  private async findByClientAttemptId(
    executor: Kysely<Database> | Transaction<Database>,
    userId: string,
    clientAttemptId: string,
  ): Promise<ActivityAttemptDto | null> {
    const rows = await sql<{ id: string }>`
      SELECT id
      FROM learning.activity_attempts
      WHERE user_id = ${userId}::uuid
        AND client_attempt_id = ${clientAttemptId}::uuid
    `.execute(executor);
    const id = rows.rows[0]?.id;
    if (!id) {
      return null;
    }
    const loaded = await this.loadAttemptBundle(executor, userId, id);
    return loaded ? toAttemptDto(loaded.attempt, loaded.score, loaded.feedback) : null;
  }

  private async rethrowOrReplayDuplicate(
    executor: Kysely<Database> | Transaction<Database>,
    userId: string,
    input: ActivityAttemptInput,
    error: unknown,
  ): Promise<SubmitAttemptResult> {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : null;
    if (
      code === "23505" ||
      message.includes("activity_attempts_user_client_attempt_key") ||
      message.includes("activity_attempts_user_activity_number_key")
    ) {
      const existing = await this.findByClientAttemptId(executor, userId, input.clientAttemptId);
      if (existing) {
        return { attempt: existing, httpStatus: 200 };
      }
      if (
        message.includes("activity_attempts_user_activity_number_key") ||
        code === "23505"
      ) {
        throw new ConflictException({
          code: "conflict",
          detail: "attemptNumber already exists for this activity.",
        });
      }
    }
    throw error;
  }

  private async loadAttemptBundle(
    executor: Kysely<Database> | Transaction<Database>,
    userId: string,
    attemptId: string,
  ): Promise<{
    readonly attempt: AttemptRow;
    readonly score: ScoreRow | null;
    readonly feedback: FeedbackRow | null;
  } | null> {
    const attempts = await sql<AttemptRow>`
      SELECT
        id,
        session_id,
        activity_version_id,
        answer_key_version_id,
        rubric_version_id,
        client_attempt_id,
        attempt_number,
        status::text AS status,
        submitted_at,
        duration_ms,
        algorithm_version,
        created_at
      FROM learning.activity_attempts
      WHERE id = ${attemptId}::uuid
        AND user_id = ${userId}::uuid
    `.execute(executor);
    const attempt = attempts.rows[0];
    if (!attempt) {
      return null;
    }

    const scores = await sql<ScoreRow>`
      SELECT
        id,
        score::text AS score,
        max_score::text AS max_score,
        passed,
        scoring_method,
        algorithm_version,
        details,
        created_at
      FROM learning.attempt_scores
      WHERE attempt_id = ${attemptId}::uuid
        AND supersedes_score_id IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `.execute(executor);

    const feedback = await sql<FeedbackRow>`
      SELECT
        id,
        feedback_kind,
        corrected_text,
        feedback,
        learner_disposition,
        content_expires_at,
        created_at
      FROM learning.feedback_records
      WHERE attempt_id = ${attemptId}::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `.execute(executor);

    return {
      attempt,
      score: scores.rows[0] ?? null,
      feedback: feedback.rows[0] ?? null,
    };
  }
}
