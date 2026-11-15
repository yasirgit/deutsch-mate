/**
 * Learning sessions (DM-038): start/update sessions pinned to published curriculum.
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { Database } from "@deutsch-mate/database";
import { createUuidV7 } from "@deutsch-mate/domain";
import { sql, type Kysely, type Transaction } from "kysely";

import type { RequestActor } from "../../platform/auth/actor.js";
import {
  buildPageResponse,
  decodeCursor,
  encodeCursor,
  parsePageParams,
} from "../../platform/cursor.js";
import { KYSELY, type KyselyToken } from "../../platform/database.tokens.js";
import { assertIfMatch } from "../../platform/etag.js";
import { getRequestStore } from "../../platform/request-context.js";
import {
  resolveLearnerEntitlement,
  type LearnerEntitlementTier,
} from "../content/curriculum.service.js";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ClientPlatform = "web" | "ios" | "android";
export type SessionStatus = "active" | "completed" | "abandoned";

export interface LearningSessionInput {
  readonly curriculumReleaseId: string;
  readonly unitVersionId: string;
  readonly lessonVersionId?: string | null;
  readonly clientPlatform: ClientPlatform;
}

export interface LearningSessionDto {
  readonly id: string;
  readonly curriculumReleaseId: string;
  readonly unitVersionId: string;
  readonly lessonVersionId: string | null;
  readonly clientPlatform: ClientPlatform;
  readonly status: SessionStatus;
  readonly startedAt: string;
  readonly lastActivityAt: string;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type SessionRow = {
  id: string;
  curriculum_release_id: string;
  unit_version_id: string;
  lesson_version_id: string | null;
  client_platform: string;
  status: SessionStatus;
  started_at: Date;
  last_activity_at: Date;
  completed_at: Date | null;
  updated_at: Date;
  lock_version: number;
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

function toDto(row: SessionRow): LearningSessionDto {
  const startedAt = toIso(row.started_at);
  return {
    id: row.id,
    curriculumReleaseId: row.curriculum_release_id,
    unitVersionId: row.unit_version_id,
    lessonVersionId: row.lesson_version_id,
    clientPlatform: row.client_platform as ClientPlatform,
    status: row.status,
    startedAt,
    lastActivityAt: toIso(row.last_activity_at),
    completedAt: row.completed_at === null ? null : toIso(row.completed_at),
    createdAt: startedAt,
    updatedAt: toIso(row.updated_at),
  };
}

@Injectable()
export class SessionService {
  constructor(@Optional() @Inject(KYSELY) private readonly db: KyselyToken | null) {}

  private requireDb(): Kysely<Database> {
    if (!this.db) {
      throw new Error("SessionService requires DATABASE_URL.");
    }
    return this.db;
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
        const correlationId = store?.requestId ?? createUuidV7();
        await sql`SELECT set_config('app.correlation_id', ${correlationId}, true)`.execute(trx);
        return fn(trx);
      });
  }

  async listSessions(
    actor: RequestActor,
    query: { readonly limit?: string | number; readonly cursor?: string },
  ): Promise<{
    readonly items: readonly LearningSessionDto[];
    readonly page: { readonly nextCursor: string | null };
  }> {
    const { limit, cursor } = parsePageParams(query);
    let cursorActivity: string | null = null;
    let cursorId: string | null = null;
    if (cursor !== null) {
      const payload = decodeCursor(cursor);
      if (
        typeof payload["lastActivityAt"] !== "string" ||
        typeof payload["id"] !== "string"
      ) {
        throw new BadRequestException({
          code: "validation_failed",
          detail: "cursor is invalid.",
        });
      }
      cursorActivity = payload["lastActivityAt"];
      cursorId = payload["id"];
    }

    return this.withApiRole(actor.userId, async (executor) => {
      const rows = await sql<SessionRow>`
        SELECT
          id,
          curriculum_release_id,
          unit_version_id,
          lesson_version_id,
          client_platform,
          status,
          started_at,
          last_activity_at,
          completed_at,
          updated_at,
          lock_version
        FROM learning.sessions
        WHERE user_id = ${actor.userId}::uuid
          AND (
            ${cursorActivity}::timestamptz IS NULL
            OR last_activity_at < ${cursorActivity}::timestamptz
            OR (
              last_activity_at = ${cursorActivity}::timestamptz
              AND id < ${cursorId}::uuid
            )
          )
        ORDER BY last_activity_at DESC, id DESC
        LIMIT ${limit + 1}
      `.execute(executor);

      const slice = rows.rows.slice(0, limit);
      const hasMore = rows.rows.length > limit;
      const last = slice[slice.length - 1];
      const nextCursor =
        hasMore && last
          ? encodeCursor({
              v: 1,
              lastActivityAt: toIso(last.last_activity_at),
              id: last.id,
            })
          : null;
      return buildPageResponse(slice.map(toDto), nextCursor);
    });
  }

  async getSession(
    actor: RequestActor,
    sessionId: string,
  ): Promise<{ readonly session: LearningSessionDto; readonly lockVersion: number }> {
    assertUuidV7(sessionId, "sessionId");
    return this.withApiRole(actor.userId, async (executor) => {
      const row = await this.loadSession(executor, actor.userId, sessionId);
      if (!row) {
        throw new NotFoundException({
          code: "not_found",
          detail: "Learning session was not found.",
        });
      }
      return { session: toDto(row), lockVersion: row.lock_version };
    });
  }

  async createSession(
    actor: RequestActor,
    input: LearningSessionInput,
  ): Promise<{ readonly session: LearningSessionDto; readonly lockVersion: number }> {
    assertUuidV7(input.curriculumReleaseId, "curriculumReleaseId");
    assertUuidV7(input.unitVersionId, "unitVersionId");
    if (input.lessonVersionId != null) {
      assertUuidV7(input.lessonVersionId, "lessonVersionId");
    }
    const entitlement = resolveLearnerEntitlement(actor);

    return this.withApiRole(actor.userId, async (executor) => {
      await this.assertAccessibleCurriculum(executor, input, entitlement);

      const id = createUuidV7();
      const now = new Date();
      const inserted = await sql<SessionRow>`
        INSERT INTO learning.sessions (
          id,
          user_id,
          curriculum_release_id,
          unit_version_id,
          lesson_version_id,
          client_platform,
          status,
          started_at,
          last_activity_at,
          completed_at,
          updated_at,
          lock_version
        ) VALUES (
          ${id}::uuid,
          ${actor.userId}::uuid,
          ${input.curriculumReleaseId}::uuid,
          ${input.unitVersionId}::uuid,
          ${input.lessonVersionId ?? null}::uuid,
          ${input.clientPlatform},
          'active',
          ${now.toISOString()}::timestamptz,
          ${now.toISOString()}::timestamptz,
          NULL,
          ${now.toISOString()}::timestamptz,
          1
        )
        RETURNING
          id,
          curriculum_release_id,
          unit_version_id,
          lesson_version_id,
          client_platform,
          status,
          started_at,
          last_activity_at,
          completed_at,
          updated_at,
          lock_version
      `.execute(executor);

      const row = inserted.rows[0];
      if (!row) {
        throw new Error("failed to insert learning session");
      }
      return { session: toDto(row), lockVersion: row.lock_version };
    });
  }

  async updateSession(
    actor: RequestActor,
    sessionId: string,
    status: "completed" | "abandoned",
    ifMatch: string | string[] | undefined,
  ): Promise<{ readonly session: LearningSessionDto; readonly lockVersion: number }> {
    assertUuidV7(sessionId, "sessionId");

    return this.withApiRole(actor.userId, async (executor) => {
      const current = await this.loadSession(executor, actor.userId, sessionId);
      if (!current) {
        throw new NotFoundException({
          code: "not_found",
          detail: "Learning session was not found.",
        });
      }
      assertIfMatch(current.lock_version, ifMatch);

      if (current.status !== "active") {
        throw new BadRequestException({
          code: "validation_failed",
          detail: "Only active sessions can be completed or abandoned.",
        });
      }

      const now = new Date();
      const completedAt = status === "completed" ? now.toISOString() : null;
      const updated = await sql<SessionRow>`
        UPDATE learning.sessions
        SET
          status = ${status}::learning.session_status,
          completed_at = ${completedAt}::timestamptz,
          last_activity_at = ${now.toISOString()}::timestamptz,
          updated_at = ${now.toISOString()}::timestamptz,
          lock_version = lock_version + 1
        WHERE id = ${sessionId}::uuid
          AND user_id = ${actor.userId}::uuid
          AND lock_version = ${current.lock_version}
        RETURNING
          id,
          curriculum_release_id,
          unit_version_id,
          lesson_version_id,
          client_platform,
          status,
          started_at,
          last_activity_at,
          completed_at,
          updated_at,
          lock_version
      `.execute(executor);

      const row = updated.rows[0];
      if (!row) {
        throw new NotFoundException({
          code: "not_found",
          detail: "Learning session was not found.",
        });
      }
      return { session: toDto(row), lockVersion: row.lock_version };
    });
  }

  private async loadSession(
    executor: Kysely<Database> | Transaction<Database>,
    userId: string,
    sessionId: string,
  ): Promise<SessionRow | null> {
    const result = await sql<SessionRow>`
      SELECT
        id,
        curriculum_release_id,
        unit_version_id,
        lesson_version_id,
        client_platform,
        status,
        started_at,
        last_activity_at,
        completed_at,
        updated_at,
        lock_version
      FROM learning.sessions
      WHERE id = ${sessionId}::uuid
        AND user_id = ${userId}::uuid
    `.execute(executor);
    return result.rows[0] ?? null;
  }

  private async assertAccessibleCurriculum(
    executor: Kysely<Database> | Transaction<Database>,
    input: LearningSessionInput,
    entitlement: LearnerEntitlementTier,
  ): Promise<void> {
    const release = await sql<{ id: string; status: string }>`
      SELECT id, status::text AS status
      FROM content.v_published_curriculum_releases
      WHERE id = ${input.curriculumReleaseId}::uuid
    `.execute(executor);
    if (!release.rows[0] || release.rows[0].status !== "published") {
      throw new NotFoundException({
        code: "not_found",
        detail: "Published curriculum release was not found.",
      });
    }

    const unitMembership = await sql<{ id: string; access_tier: string }>`
      SELECT uv.id, uv.access_tier
      FROM content.v_published_unit_versions AS uv
      JOIN content.module_units AS mu ON mu.unit_version_id = uv.id
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      WHERE uv.id = ${input.unitVersionId}::uuid
        AND rm.release_id = ${input.curriculumReleaseId}::uuid
    `.execute(executor);

    const unitRow = unitMembership.rows[0];
    if (!unitRow) {
      throw new NotFoundException({
        code: "not_found",
        detail: "Published unit was not found in the curriculum release.",
      });
    }

    if (unitRow.access_tier === "premium" && entitlement === "free") {
      throw new ForbiddenException({
        code: "entitlement_required",
        detail:
          "Premium curriculum requires an active premium entitlement. Until billing (DM-053), learners are free-tier only.",
      });
    }

    if (input.lessonVersionId != null) {
      const lesson = await sql<{ id: string }>`
        SELECT lv.id
        FROM content.v_published_lesson_versions AS lv
        JOIN content.unit_lessons AS ul ON ul.lesson_version_id = lv.id
        WHERE lv.id = ${input.lessonVersionId}::uuid
          AND ul.unit_version_id = ${input.unitVersionId}::uuid
      `.execute(executor);
      if (!lesson.rows[0]) {
        throw new NotFoundException({
          code: "not_found",
          detail: "Published lesson was not found on the unit.",
        });
      }
    }
  }
}
