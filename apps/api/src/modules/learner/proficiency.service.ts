/**
 * Append-only proficiency snapshots (DM-037).
 *
 * MVP: explicit self-selected CEFR only — no LLM placement. overall_estimate
 * stays NULL (Database.md). Skill vector records the self-select baseline.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Database } from "@deutsch-mate/database";
import { createUuidV7 } from "@deutsch-mate/domain";
import { sql, type Kysely, type Transaction } from "kysely";

import { KYSELY, type KyselyToken } from "../../platform/database.tokens.js";
import { getRequestStore } from "../../platform/request-context.js";

export type CefrLevel = "A1" | "A2" | "B1" | "B2";

export const SELF_SELECT_ALGORITHM = "self_select.v1";

const SKILLS = ["reading", "listening", "writing", "vocabulary", "grammar"] as const;

export interface ProficiencySnapshotDto {
  readonly id: string;
  readonly sequence: number;
  readonly algorithmVersion: string;
  readonly evidenceCutoffAt: string;
  readonly skillVector: Record<
    string,
    { readonly estimate: CefrLevel; readonly uncertainty: number; readonly evidenceCount: number }
  >;
  readonly overallEstimate: CefrLevel | null;
  readonly disclaimerCode: string;
  readonly createdAt: string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function buildSelfSelectSkillVector(level: CefrLevel): Record<
  string,
  { estimate: CefrLevel; uncertainty: number; evidenceCount: number }
> {
  const vector: Record<string, { estimate: CefrLevel; uncertainty: number; evidenceCount: number }> =
    {};
  for (const skill of SKILLS) {
    vector[skill] = {
      estimate: level,
      uncertainty: 1,
      evidenceCount: 0,
    };
  }
  return vector;
}

@Injectable()
export class ProficiencyService {
  constructor(@Optional() @Inject(KYSELY) private readonly db: KyselyToken | null) {}

  private requireDb(): Kysely<Database> {
    if (!this.db) {
      throw new Error("ProficiencyService requires DATABASE_URL.");
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

  async getLatest(userId: string): Promise<ProficiencySnapshotDto | null> {
    return this.withApiRole(userId, async (executor) => {
      const rows = await sql<{
        id: string;
        sequence: number;
        algorithm_version: string;
        evidence_cutoff_at: Date;
        skill_vector: unknown;
        overall_estimate: CefrLevel | null;
        disclaimer_code: string;
        created_at: Date;
      }>`
        SELECT
          id,
          sequence,
          algorithm_version,
          evidence_cutoff_at,
          skill_vector,
          overall_estimate,
          disclaimer_code,
          created_at
        FROM learner.proficiency_snapshots
        WHERE user_id = ${userId}::uuid
        ORDER BY sequence DESC
        LIMIT 1
      `.execute(executor);

      const row = rows.rows[0];
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        sequence: row.sequence,
        algorithmVersion: row.algorithm_version,
        evidenceCutoffAt: toIso(row.evidence_cutoff_at),
        skillVector: row.skill_vector as ProficiencySnapshotDto["skillVector"],
        overallEstimate: row.overall_estimate,
        disclaimerCode: row.disclaimer_code,
        createdAt: toIso(row.created_at),
      };
    });
  }

  /**
   * Append a self-select baseline snapshot when the learner sets/changes level.
   * Never sets overall_estimate (reserved post-MVP). No LLM involvement.
   */
  async appendSelfSelectSnapshot(
    userId: string,
    selectedLevel: CefrLevel,
  ): Promise<ProficiencySnapshotDto> {
    return this.withApiRole(userId, async (executor) => {
      const latest = await sql<{ sequence: number }>`
        SELECT sequence
        FROM learner.proficiency_snapshots
        WHERE user_id = ${userId}::uuid
        ORDER BY sequence DESC
        LIMIT 1
      `.execute(executor);

      const nextSequence = (latest.rows[0]?.sequence ?? 0) + 1;
      const id = createUuidV7();
      const skillVector = buildSelfSelectSkillVector(selectedLevel);
      const inserted = await sql<{
        id: string;
        sequence: number;
        algorithm_version: string;
        evidence_cutoff_at: Date;
        skill_vector: unknown;
        overall_estimate: CefrLevel | null;
        disclaimer_code: string;
        created_at: Date;
      }>`
        INSERT INTO learner.proficiency_snapshots (
          id,
          user_id,
          sequence,
          algorithm_version,
          evidence_cutoff_at,
          skill_vector,
          overall_estimate,
          disclaimer_code
        )
        VALUES (
          ${id}::uuid,
          ${userId}::uuid,
          ${nextSequence},
          ${SELF_SELECT_ALGORITHM},
          now(),
          ${JSON.stringify(skillVector)}::jsonb,
          NULL,
          'cefr_estimate_not_certificate'
        )
        RETURNING
          id,
          sequence,
          algorithm_version,
          evidence_cutoff_at,
          skill_vector,
          overall_estimate,
          disclaimer_code,
          created_at
      `.execute(executor);

      const row = inserted.rows[0];
      if (!row) {
        throw new Error("proficiency snapshot insert returned no row");
      }
      return {
        id: row.id,
        sequence: row.sequence,
        algorithmVersion: row.algorithm_version,
        evidenceCutoffAt: toIso(row.evidence_cutoff_at),
        skillVector: row.skill_vector as ProficiencySnapshotDto["skillVector"],
        overallEstimate: row.overall_estimate,
        disclaimerCode: row.disclaimer_code,
        createdAt: toIso(row.created_at),
      };
    });
  }
}
