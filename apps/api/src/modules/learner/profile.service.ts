/**
 * Append-only learner profile versions (DM-037 / FR-003).
 *
 * Interface locale is owned by IdentityService (`PATCH /me`) — never stored here.
 */

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { Database } from "@deutsch-mate/database";
import { createUuidV7 } from "@deutsch-mate/domain";
import { sql, type Kysely, type Transaction } from "kysely";

import { KYSELY, type KyselyToken } from "../../platform/database.tokens.js";
import { assertIfMatch } from "../../platform/etag.js";
import { getRequestStore } from "../../platform/request-context.js";
import { ProficiencyService, type CefrLevel } from "./proficiency.service.js";

export type GoalCode =
  | "relocation"
  | "work"
  | "study"
  | "travel"
  | "daily_life"
  | "general";

export interface ProfileInput {
  readonly goal: GoalCode;
  readonly selectedLevel: CefrLevel;
  readonly targetLevel?: CefrLevel | null;
  readonly studyMinutesPerDay?: number | null;
  readonly studyDaysPerWeek?: number | null;
  readonly preferences: Record<string, unknown>;
}

export interface ProfileVersionDto {
  readonly id: string;
  readonly version: number;
  readonly goal: GoalCode;
  readonly selectedLevel: CefrLevel;
  readonly targetLevel: CefrLevel | null;
  readonly studyMinutesPerDay: number | null;
  readonly studyDaysPerWeek: number | null;
  readonly preferences: Record<string, unknown>;
  readonly supersedesId: string | null;
  readonly effectiveAt: string;
  readonly createdAt: string;
}

type ProfileRow = {
  id: string;
  version: number;
  goal: GoalCode;
  selected_level: CefrLevel;
  target_level: CefrLevel | null;
  study_minutes_per_day: number | null;
  study_days_per_week: number | null;
  preferences: unknown;
  supersedes_id: string | null;
  effective_at: Date;
  created_at: Date;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asPreferences(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

@Injectable()
export class ProfileService {
  constructor(
    @Optional() @Inject(KYSELY) private readonly db: KyselyToken | null,
    private readonly proficiency: ProficiencyService,
  ) {}

  private requireDb(): Kysely<Database> {
    if (!this.db) {
      throw new Error("ProfileService requires DATABASE_URL.");
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
        return fn(trx);
      });
  }

  async getCurrentProfile(userId: string): Promise<{
    readonly profile: ProfileVersionDto;
    readonly etagVersion: number;
  }> {
    const tip = await this.loadTip(userId);
    if (!tip) {
      throw new NotFoundException({
        code: "not_found",
        detail: "Learner profile was not found.",
      });
    }
    return { profile: tip, etagVersion: tip.version };
  }

  /**
   * Append a new immutable profile version.
   * If-Match equals the current tip version; first create requires If-Match `"1"`.
   */
  async appendProfileVersion(
    userId: string,
    input: ProfileInput,
    ifMatch: string | string[] | undefined,
  ): Promise<{ readonly profile: ProfileVersionDto; readonly etagVersion: number }> {
    return this.withApiRole(userId, async (executor) => {
      const tip = await this.loadTipWith(executor, userId);
      const expectedEtag = tip === null ? 1 : tip.version;
      assertIfMatch(expectedEtag, ifMatch);

      const nextVersion = tip === null ? 1 : tip.version + 1;
      const id = createUuidV7();
      const targetLevel = input.targetLevel === undefined ? null : input.targetLevel;
      const studyMinutes =
        input.studyMinutesPerDay === undefined ? null : input.studyMinutesPerDay;
      const studyDays = input.studyDaysPerWeek === undefined ? null : input.studyDaysPerWeek;
      const preferences = input.preferences ?? {};

      const inserted = await sql<ProfileRow>`
        INSERT INTO learner.profile_versions (
          id,
          user_id,
          version,
          goal,
          selected_level,
          target_level,
          study_minutes_per_day,
          study_days_per_week,
          preferences,
          supersedes_id
        )
        VALUES (
          ${id}::uuid,
          ${userId}::uuid,
          ${nextVersion},
          ${input.goal}::learner.goal_code,
          ${input.selectedLevel}::learner.cefr_level,
          ${targetLevel}::learner.cefr_level,
          ${studyMinutes},
          ${studyDays},
          ${JSON.stringify(preferences)}::jsonb,
          ${tip?.id ?? null}::uuid
        )
        RETURNING
          id,
          version,
          goal,
          selected_level,
          target_level,
          study_minutes_per_day,
          study_days_per_week,
          preferences,
          supersedes_id,
          effective_at,
          created_at
      `.execute(executor);

      const row = inserted.rows[0];
      if (!row) {
        throw new ConflictException({
          code: "etag_mismatch",
          detail: "If-Match does not match the current resource version.",
        });
      }

      const levelChanged = tip === null || tip.selectedLevel !== input.selectedLevel;
      if (levelChanged) {
        await this.proficiency.appendSelfSelectSnapshot(userId, input.selectedLevel);
      }

      const profile = this.toDto(row);
      return { profile, etagVersion: profile.version };
    });
  }

  private async loadTip(userId: string): Promise<ProfileVersionDto | null> {
    return this.withApiRole(userId, (executor) => this.loadTipWith(executor, userId));
  }

  private async loadTipWith(
    executor: Kysely<Database> | Transaction<Database>,
    userId: string,
  ): Promise<ProfileVersionDto | null> {
    const rows = await sql<ProfileRow>`
      SELECT
        id,
        version,
        goal,
        selected_level,
        target_level,
        study_minutes_per_day,
        study_days_per_week,
        preferences,
        supersedes_id,
        effective_at,
        created_at
      FROM learner.profile_versions
      WHERE user_id = ${userId}::uuid
      ORDER BY version DESC
      LIMIT 1
    `.execute(executor);

    const row = rows.rows[0];
    return row ? this.toDto(row) : null;
  }

  private toDto(row: ProfileRow): ProfileVersionDto {
    return {
      id: row.id,
      version: row.version,
      goal: row.goal,
      selectedLevel: row.selected_level,
      targetLevel: row.target_level,
      studyMinutesPerDay: row.study_minutes_per_day,
      studyDaysPerWeek: row.study_days_per_week,
      preferences: asPreferences(row.preferences),
      supersedesId: row.supersedes_id,
      effectiveAt: toIso(row.effective_at),
      createdAt: toIso(row.created_at),
    };
  }
}
