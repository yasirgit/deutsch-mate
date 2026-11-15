/**
 * Resumable onboarding projection (DM-037 / FR-010).
 *
 * Completes with the first free published unit at the self-selected level
 * (CurriculumService). No LLM placement.
 */

import {
  ConflictException,
  Inject,
  Injectable,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Database } from "@deutsch-mate/database";
import { sql, type Kysely, type Transaction } from "kysely";

import type { UnitSummaryDto } from "../content/curriculum.service.js";
import { CurriculumService } from "../content/curriculum.service.js";
import { KYSELY, type KyselyToken } from "../../platform/database.tokens.js";
import { assertIfMatch } from "../../platform/etag.js";
import { getRequestStore } from "../../platform/request-context.js";
import { ProfileService } from "./profile.service.js";

export interface OnboardingStateDto {
  readonly stepCode: string;
  readonly completedSteps: readonly string[];
  readonly completedAt: string | null;
  readonly recommendedUnitVersionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OnboardingPatch {
  readonly stepCode?: string;
  readonly completedSteps?: readonly string[];
}

type OnboardingRow = {
  user_id: string;
  step_code: string;
  completed_steps: unknown;
  completed_at: Date | null;
  recommended_unit_version_id: string | null;
  created_at: Date;
  updated_at: Date;
  lock_version: number;
};

function toIso(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseCompletedSteps(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

@Injectable()
export class OnboardingService {
  constructor(
    @Optional() @Inject(KYSELY) private readonly db: KyselyToken | null,
    private readonly profiles: ProfileService,
    private readonly curriculum: CurriculumService,
  ) {}

  private requireDb(): Kysely<Database> {
    if (!this.db) {
      throw new Error("OnboardingService requires DATABASE_URL.");
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

  async getState(userId: string): Promise<{
    readonly onboarding: OnboardingStateDto;
    readonly lockVersion: number;
  }> {
    const row = await this.ensureRow(userId);
    return { onboarding: this.toDto(row), lockVersion: row.lock_version };
  }

  async patchState(
    userId: string,
    patch: OnboardingPatch,
    ifMatch: string | string[] | undefined,
  ): Promise<{
    readonly onboarding: OnboardingStateDto;
    readonly lockVersion: number;
  }> {
    return this.withApiRole(userId, async (executor) => {
      const current = await this.ensureRowWith(executor, userId);
      assertIfMatch(current.lock_version, ifMatch);

      if (current.completed_at !== null) {
        throw new UnprocessableEntityException({
          code: "onboarding_already_complete",
          detail: "Onboarding is already complete and cannot be patched.",
        });
      }

      const nextStep = patch.stepCode ?? current.step_code;
      const nextCompleted =
        patch.completedSteps !== undefined
          ? [...patch.completedSteps]
          : parseCompletedSteps(current.completed_steps);

      const updated = await sql<OnboardingRow>`
        UPDATE learner.onboarding_states AS o
        SET
          step_code = ${nextStep},
          completed_steps = ${JSON.stringify(nextCompleted)}::jsonb,
          updated_at = now(),
          lock_version = o.lock_version + 1
        WHERE o.user_id = ${userId}::uuid
          AND o.lock_version = ${current.lock_version}
        RETURNING
          user_id,
          step_code,
          completed_steps,
          completed_at,
          recommended_unit_version_id,
          created_at,
          updated_at,
          lock_version
      `.execute(executor);

      const row = updated.rows[0];
      if (!row) {
        throw new ConflictException({
          code: "etag_mismatch",
          detail: "If-Match does not match the current resource version.",
        });
      }
      return { onboarding: this.toDto(row), lockVersion: row.lock_version };
    });
  }

  async complete(userId: string): Promise<{
    readonly onboarding: OnboardingStateDto;
    readonly recommendedUnit: UnitSummaryDto;
  }> {
    return this.withApiRole(userId, async (executor) => {
      const current = await this.ensureRowWith(executor, userId);

      if (current.completed_at !== null && current.recommended_unit_version_id !== null) {
        const unit = await this.curriculum.getUnitSummary(current.recommended_unit_version_id);
        if (!unit) {
          throw new UnprocessableEntityException({
            code: "onboarding_incomplete",
            detail: "Previously recommended unit is no longer in the published curriculum.",
          });
        }
        return { onboarding: this.toDto(current), recommendedUnit: unit };
      }

      await this.assertRequiredConsents(executor, userId);

      let profile;
      try {
        ({ profile } = await this.profiles.getCurrentProfile(userId));
      } catch {
        throw new UnprocessableEntityException({
          code: "onboarding_incomplete",
          detail:
            "A learner profile with a self-selected level is required before completing onboarding.",
        });
      }

      const unit = await this.curriculum.findFirstFreeUnitAtLevel(profile.selectedLevel);
      if (!unit) {
        throw new UnprocessableEntityException({
          code: "onboarding_incomplete",
          detail: `No published free-tier unit is available for level ${profile.selectedLevel}.`,
        });
      }

      const completedSteps = new Set(parseCompletedSteps(current.completed_steps));
      completedSteps.add("legal");
      completedSteps.add("goal");
      completedSteps.add("level");
      completedSteps.add("complete");

      const updated = await sql<OnboardingRow>`
        UPDATE learner.onboarding_states AS o
        SET
          step_code = 'complete',
          completed_steps = ${JSON.stringify([...completedSteps])}::jsonb,
          completed_at = coalesce(o.completed_at, now()),
          recommended_unit_version_id = ${unit.id}::uuid,
          updated_at = now(),
          lock_version = o.lock_version + 1
        WHERE o.user_id = ${userId}::uuid
          AND o.completed_at IS NULL
        RETURNING
          user_id,
          step_code,
          completed_steps,
          completed_at,
          recommended_unit_version_id,
          created_at,
          updated_at,
          lock_version
      `.execute(executor);

      const row = updated.rows[0];
      if (!row) {
        const reloaded = await this.ensureRowWith(executor, userId);
        if (reloaded.recommended_unit_version_id === null) {
          throw new UnprocessableEntityException({
            code: "onboarding_incomplete",
            detail: "Onboarding could not be completed.",
          });
        }
        const existing = await this.curriculum.getUnitSummary(
          reloaded.recommended_unit_version_id,
        );
        if (!existing) {
          throw new UnprocessableEntityException({
            code: "onboarding_incomplete",
            detail: "Previously recommended unit is no longer in the published curriculum.",
          });
        }
        return { onboarding: this.toDto(reloaded), recommendedUnit: existing };
      }

      return { onboarding: this.toDto(row), recommendedUnit: unit };
    });
  }

  private async assertRequiredConsents(
    executor: Kysely<Database> | Transaction<Database>,
    userId: string,
  ): Promise<void> {
    const rows = await sql<{ purpose_code: string; decision: string }>`
      SELECT DISTINCT ON (ce.purpose_code)
        ce.purpose_code,
        ce.decision::text AS decision
      FROM iam.consent_events AS ce
      WHERE ce.user_id = ${userId}::uuid
        AND ce.purpose_code IN ('terms', 'privacy')
      ORDER BY ce.purpose_code, ce.occurred_at DESC, ce.id DESC
    `.execute(executor);

    const byPurpose = new Map(rows.rows.map((r) => [r.purpose_code, r.decision]));
    if (byPurpose.get("terms") !== "granted" || byPurpose.get("privacy") !== "granted") {
      throw new UnprocessableEntityException({
        code: "onboarding_incomplete",
        detail: "Required terms and privacy consent must be granted before completing onboarding.",
      });
    }
  }

  private async ensureRow(userId: string): Promise<OnboardingRow> {
    return this.withApiRole(userId, (executor) => this.ensureRowWith(executor, userId));
  }

  private async ensureRowWith(
    executor: Kysely<Database> | Transaction<Database>,
    userId: string,
  ): Promise<OnboardingRow> {
    const existing = await sql<OnboardingRow>`
      SELECT
        user_id,
        step_code,
        completed_steps,
        completed_at,
        recommended_unit_version_id,
        created_at,
        updated_at,
        lock_version
      FROM learner.onboarding_states
      WHERE user_id = ${userId}::uuid
    `.execute(executor);

    if (existing.rows[0]) {
      return existing.rows[0];
    }

    const inserted = await sql<OnboardingRow>`
      INSERT INTO learner.onboarding_states (user_id)
      VALUES (${userId}::uuid)
      ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
      RETURNING
        user_id,
        step_code,
        completed_steps,
        completed_at,
        recommended_unit_version_id,
        created_at,
        updated_at,
        lock_version
    `.execute(executor);

    const row = inserted.rows[0];
    if (!row) {
      throw new Error("onboarding_states insert returned no row");
    }
    return row;
  }

  private toDto(row: OnboardingRow): OnboardingStateDto {
    return {
      stepCode: row.step_code,
      completedSteps: parseCompletedSteps(row.completed_steps),
      completedAt: toIso(row.completed_at),
      recommendedUnitVersionId: row.recommended_unit_version_id,
      createdAt: toIso(row.created_at)!,
      updatedAt: toIso(row.updated_at)!,
    };
  }
}
