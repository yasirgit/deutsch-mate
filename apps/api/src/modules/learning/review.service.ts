/**
 * Review items projection: same-transaction updater + rebuildable from evidence (DM-039).
 */

import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { Database } from "@deutsch-mate/database";
import { createUuidV7 } from "@deutsch-mate/domain";
import {
  REVIEW_ALGORITHM_VERSION,
  boundActiveQueue,
  projectReviewQueue,
  scheduleFromEvidence,
  type ReviewEvidenceInput,
  type ReviewQueueItem,
} from "@deutsch-mate/review-algorithm";
import { sql, type Kysely, type Transaction } from "kysely";

import type { RequestActor } from "../../platform/auth/actor.js";
import {
  buildPageResponse,
  decodeCursor,
  encodeCursor,
  parsePageParams,
} from "../../platform/cursor.js";
import { KYSELY, type KyselyToken } from "../../platform/database.tokens.js";
import { getRequestStore, requireRequestStore } from "../../platform/request-context.js";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REVIEW_STATES = new Set(["due", "scheduled", "completed", "suspended"]);

export interface ReviewItemDto {
  readonly id: string;
  readonly objectiveVersionId: string;
  readonly sourceAttemptId: string;
  readonly algorithmVersion: string;
  readonly dueAt: string;
  readonly intervalDays: string;
  readonly ease: string;
  readonly state: "due" | "scheduled" | "completed" | "suspended";
  readonly lastEvidenceId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReviewItemPageDto {
  readonly items: readonly ReviewItemDto[];
  readonly page: { readonly nextCursor: string | null };
}

export interface NewEvidenceForReview {
  readonly evidenceId: string;
  readonly attemptId: string;
  readonly objectiveVersionId: string;
  readonly skill: string;
  readonly scoreRatio: number;
  readonly validity: "valid" | "invalid" | "unverified";
  readonly observedAt: Date;
}

type ReviewRow = {
  id: string;
  objective_version_id: string;
  source_attempt_id: string;
  algorithm_version: string;
  due_at: Date;
  interval_days: string;
  ease: string;
  state: string;
  last_evidence_id: string;
  created_at: Date;
  updated_at: Date;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function decimalString(value: number | string, digits: number): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return (0).toFixed(digits);
  }
  return n.toFixed(digits);
}

function toReviewDto(row: ReviewRow): ReviewItemDto {
  const state =
    row.state === "due" ||
    row.state === "scheduled" ||
    row.state === "completed" ||
    row.state === "suspended"
      ? row.state
      : "suspended";
  return {
    id: row.id,
    objectiveVersionId: row.objective_version_id,
    sourceAttemptId: row.source_attempt_id,
    algorithmVersion: row.algorithm_version,
    dueAt: toIso(row.due_at),
    intervalDays: decimalString(row.interval_days, 2),
    ease: decimalString(row.ease, 3),
    state,
    lastEvidenceId: row.last_evidence_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

@Injectable()
export class ReviewService {
  constructor(@Inject(KYSELY) private readonly db: KyselyToken) {}

  /**
   * Apply review projection updates for newly inserted evidence inside the
   * attempt-scored transaction. Invalid/unverified rows are ignored.
   */
  async applyEvidenceInTransaction(
    executor: Kysely<Database> | Transaction<Database>,
    userId: string,
    evidenceRows: readonly NewEvidenceForReview[],
    asOf: Date,
  ): Promise<void> {
    for (const row of evidenceRows) {
      const scheduled = scheduleFromEvidence(
        {
          evidenceId: row.evidenceId,
          userId,
          attemptId: row.attemptId,
          objectiveVersionId: row.objectiveVersionId,
          skill: row.skill,
          scoreRatio: row.scoreRatio,
          validity: row.validity,
          observedAt: row.observedAt,
        },
        asOf,
        null,
      );
      if (!scheduled) {
        continue;
      }
      await this.upsertReviewItem(executor, scheduled, asOf);
    }
    await this.applyQueueBound(executor, userId, asOf);
  }

  /**
   * Idempotent rebuild of learning.review_items for one user from append-only evidence.
   * Deletes existing rows then inserts the projected queue (matches live updater).
   */
  async rebuildForUser(
    executor: Kysely<Database> | Transaction<Database>,
    userId: string,
    asOf: Date = new Date(),
  ): Promise<{ readonly activeCount: number; readonly suspendedCount: number }> {
    const history = await this.loadEvidenceHistory(executor, userId);
    const { active, suspended } = projectReviewQueue(history, asOf);

    await sql`
      DELETE FROM learning.review_items
      WHERE user_id = ${userId}::uuid
    `.execute(executor);

    for (const item of active) {
      await this.insertReviewItem(executor, item, item.state, asOf);
    }
    for (const item of suspended) {
      await this.insertReviewItem(executor, item, "suspended", asOf);
    }

    return { activeCount: active.length, suspendedCount: suspended.length };
  }

  /** Rebuild using dm_api RLS context (for scripts / API-adjacent ops). */
  async rebuildForUserAsActor(
    actor: RequestActor,
    asOf: Date = new Date(),
  ): Promise<{ readonly activeCount: number; readonly suspendedCount: number }> {
    return this.withApiRole(actor.userId, async (executor) =>
      this.rebuildForUser(executor, actor.userId, asOf),
    );
  }

  async listReviewItems(
    actor: RequestActor,
    query: {
      readonly state?: string;
      readonly cursor?: string;
      readonly limit?: string | number;
    },
  ): Promise<ReviewItemPageDto> {
    const state = query.state === undefined || query.state === "" ? "due" : query.state;
    if (!REVIEW_STATES.has(state)) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "state must be one of due, scheduled, completed, suspended.",
      });
    }
    const pageParams = parsePageParams(query);
    let afterDueAt: string | null = null;
    let afterObjectiveId: string | null = null;
    let afterId: string | null = null;
    if (pageParams.cursor !== null) {
      const payload = decodeCursor(pageParams.cursor);
      const dueAt = payload["dueAt"];
      const objectiveVersionId = payload["objectiveVersionId"];
      const id = payload["id"];
      if (
        typeof dueAt !== "string" ||
        typeof objectiveVersionId !== "string" ||
        typeof id !== "string" ||
        !UUID_V7_RE.test(objectiveVersionId) ||
        !UUID_V7_RE.test(id)
      ) {
        throw new BadRequestException({
          code: "validation_failed",
          detail: "cursor is invalid.",
        });
      }
      afterDueAt = dueAt;
      afterObjectiveId = objectiveVersionId;
      afterId = id;
    }

    return this.withApiRole(actor.userId, async (executor) => {
      const rows = await sql<ReviewRow>`
        SELECT
          id,
          objective_version_id,
          source_attempt_id,
          algorithm_version,
          due_at,
          interval_days::text AS interval_days,
          ease::text AS ease,
          state,
          last_evidence_id,
          created_at,
          updated_at
        FROM learning.review_items
        WHERE user_id = ${actor.userId}::uuid
          AND state = ${state}
          AND (
            ${afterDueAt}::timestamptz IS NULL
            OR (due_at, objective_version_id, id) >
               (${afterDueAt}::timestamptz, ${afterObjectiveId}::uuid, ${afterId}::uuid)
          )
        ORDER BY due_at ASC, objective_version_id ASC, id ASC
        LIMIT ${pageParams.limit + 1}
      `.execute(executor);

      const hasMore = rows.rows.length > pageParams.limit;
      const pageRows = hasMore ? rows.rows.slice(0, pageParams.limit) : rows.rows;
      const items = pageRows.map(toReviewDto);
      const last = pageRows[pageRows.length - 1];
      const nextCursor =
        hasMore && last
          ? encodeCursor({
              v: 1,
              dueAt: toIso(last.due_at),
              objectiveVersionId: last.objective_version_id,
              id: last.id,
            })
          : null;
      return buildPageResponse(items, nextCursor);
    });
  }

  private async loadEvidenceHistory(
    executor: Kysely<Database> | Transaction<Database>,
    userId: string,
  ): Promise<ReviewEvidenceInput[]> {
    const rows = await sql<{
      id: string;
      attempt_id: string;
      objective_version_id: string;
      skill: string;
      score_ratio: string | null;
      validity: string;
      observed_at: Date;
    }>`
      SELECT
        e.id,
        e.attempt_id,
        e.objective_version_id,
        ov.skill::text AS skill,
        e.score_ratio::text AS score_ratio,
        e.validity::text AS validity,
        e.observed_at
      FROM learning.evidence AS e
      JOIN content.objective_versions AS ov ON ov.id = e.objective_version_id
      WHERE e.user_id = ${userId}::uuid
      ORDER BY e.observed_at ASC, e.id ASC
    `.execute(executor);

    return rows.rows.map((row) => ({
      evidenceId: row.id,
      userId,
      attemptId: row.attempt_id,
      objectiveVersionId: row.objective_version_id,
      skill: row.skill,
      scoreRatio: row.score_ratio === null ? null : Number(row.score_ratio),
      validity:
        row.validity === "invalid" || row.validity === "unverified"
          ? row.validity
          : "valid",
      observedAt:
        row.observed_at instanceof Date
          ? row.observed_at
          : new Date(row.observed_at),
    }));
  }

  private async upsertReviewItem(
    executor: Kysely<Database> | Transaction<Database>,
    item: {
      readonly userId: string;
      readonly objectiveVersionId: string;
      readonly sourceAttemptId: string;
      readonly algorithmVersion: string;
      readonly dueAt: Date;
      readonly intervalDays: number;
      readonly ease: number;
      readonly state: string;
      readonly lastEvidenceId: string;
    },
    asOf: Date,
  ): Promise<void> {
    const id = createUuidV7();
    await sql`
      INSERT INTO learning.review_items (
        id, user_id, objective_version_id, source_attempt_id, algorithm_version,
        due_at, interval_days, ease, state, last_evidence_id,
        created_at, updated_at, lock_version
      ) VALUES (
        ${id}::uuid,
        ${item.userId}::uuid,
        ${item.objectiveVersionId}::uuid,
        ${item.sourceAttemptId}::uuid,
        ${item.algorithmVersion},
        ${item.dueAt.toISOString()}::timestamptz,
        ${decimalString(item.intervalDays, 2)}::numeric,
        ${decimalString(item.ease, 3)}::numeric,
        ${item.state},
        ${item.lastEvidenceId}::uuid,
        ${asOf.toISOString()}::timestamptz,
        ${asOf.toISOString()}::timestamptz,
        1
      )
      ON CONFLICT (user_id, objective_version_id, source_attempt_id) DO UPDATE SET
        algorithm_version = EXCLUDED.algorithm_version,
        due_at = EXCLUDED.due_at,
        interval_days = EXCLUDED.interval_days,
        ease = EXCLUDED.ease,
        state = EXCLUDED.state,
        last_evidence_id = EXCLUDED.last_evidence_id,
        updated_at = EXCLUDED.updated_at,
        lock_version = learning.review_items.lock_version + 1
    `.execute(executor);
  }

  private async insertReviewItem(
    executor: Kysely<Database> | Transaction<Database>,
    item: ReviewQueueItem,
    state: string,
    asOf: Date,
  ): Promise<void> {
    await sql`
      INSERT INTO learning.review_items (
        id, user_id, objective_version_id, source_attempt_id, algorithm_version,
        due_at, interval_days, ease, state, last_evidence_id,
        created_at, updated_at, lock_version
      ) VALUES (
        ${createUuidV7()}::uuid,
        ${item.userId}::uuid,
        ${item.objectiveVersionId}::uuid,
        ${item.sourceAttemptId}::uuid,
        ${REVIEW_ALGORITHM_VERSION},
        ${item.dueAt.toISOString()}::timestamptz,
        ${decimalString(item.intervalDays, 2)}::numeric,
        ${decimalString(item.ease, 3)}::numeric,
        ${state},
        ${item.lastEvidenceId}::uuid,
        ${asOf.toISOString()}::timestamptz,
        ${asOf.toISOString()}::timestamptz,
        1
      )
    `.execute(executor);
  }

  private async applyQueueBound(
    executor: Kysely<Database> | Transaction<Database>,
    userId: string,
    asOf: Date,
  ): Promise<void> {
    const rows = await sql<{
      id: string;
      objective_version_id: string;
      source_attempt_id: string;
      algorithm_version: string;
      due_at: Date;
      interval_days: string;
      ease: string;
      state: string;
      last_evidence_id: string;
    }>`
      SELECT
        id,
        objective_version_id,
        source_attempt_id,
        algorithm_version,
        due_at,
        interval_days::text AS interval_days,
        ease::text AS ease,
        state,
        last_evidence_id
      FROM learning.review_items
      WHERE user_id = ${userId}::uuid
        AND state IN ('due', 'scheduled')
    `.execute(executor);

    const candidates: ReviewQueueItem[] = rows.rows.map((row) => ({
      algorithmVersion: row.algorithm_version,
      userId,
      objectiveVersionId: row.objective_version_id,
      sourceAttemptId: row.source_attempt_id,
      lastEvidenceId: row.last_evidence_id,
      dueAt: row.due_at instanceof Date ? row.due_at : new Date(row.due_at),
      intervalDays: Number(row.interval_days),
      ease: Number(row.ease),
      state: row.state === "due" ? "due" : "scheduled",
      sortKey: row.id,
    }));

    const { suspend } = boundActiveQueue(candidates);
    for (const item of suspend) {
      await sql`
        UPDATE learning.review_items
        SET
          state = 'suspended',
          updated_at = ${asOf.toISOString()}::timestamptz,
          lock_version = lock_version + 1
        WHERE user_id = ${userId}::uuid
          AND objective_version_id = ${item.objectiveVersionId}::uuid
          AND source_attempt_id = ${item.sourceAttemptId}::uuid
          AND state IN ('due', 'scheduled')
      `.execute(executor);
    }
  }

  private async withApiRole<T>(
    userId: string,
    fn: (executor: Transaction<Database>) => Promise<T>,
  ): Promise<T> {
    const store = getRequestStore();
    const roles = store?.actor?.roles.join(",") ?? "learner";
    return this.db.transaction().execute(async (trx) => {
      await sql`SET LOCAL ROLE dm_api`.execute(trx);
      await sql`SELECT set_config('app.user_id', ${userId}, true)`.execute(trx);
      await sql`SELECT set_config('app.roles', ${roles}, true)`.execute(trx);
      await sql`SELECT set_config('app.correlation_id', ${this.correlationId()}, true)`.execute(
        trx,
      );
      return fn(trx);
    });
  }

  private correlationId(): string {
    return requireRequestStore().requestId;
  }
}
