/**
 * Versioned consent and legal-document services (DM-036).
 *
 * Consents are append-only. Current state = latest event per purpose.
 * terms/privacy require documentVersionId; marketing is optional and must omit it.
 */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  Inject,
} from "@nestjs/common";
import { createUuidV7 } from "@deutsch-mate/domain";
import type { Database } from "@deutsch-mate/database";
import { sql, type Kysely, type Transaction } from "kysely";

import { KYSELY, type KyselyToken } from "../../platform/database.tokens.js";
import { getRequestStore, requireRequestStore } from "../../platform/request-context.js";

export type ConsentPurpose = "terms" | "privacy" | "marketing";
export type ConsentDecision = "granted" | "withdrawn" | "declined";
export type ConsentSource = "web" | "ios" | "android";

export interface LegalDocumentVersionDto {
  readonly id: string;
  readonly documentCode: "terms" | "privacy" | "marketing";
  readonly version: number;
  readonly locale: string;
  readonly sha256: string;
  readonly publishedAt: string;
  readonly effectiveAt: string;
}

export interface ConsentEventDto {
  readonly id: string;
  readonly documentVersionId?: string;
  readonly purposeCode: ConsentPurpose;
  readonly decision: ConsentDecision;
  readonly source: ConsentSource | "admin";
  readonly occurredAt: string;
}

export interface ConsentEventInput {
  readonly documentVersionId?: string;
  readonly purposeCode: ConsentPurpose;
  readonly decision: ConsentDecision;
  readonly source: ConsentSource;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

@Injectable()
export class ConsentService {
  constructor(@Optional() @Inject(KYSELY) private readonly db: KyselyToken | null) {}

  private requireDb(): Kysely<Database> {
    if (!this.db) {
      throw new Error("ConsentService requires DATABASE_URL.");
    }
    return this.db;
  }

  private trxOrDb(): Kysely<Database> | Transaction<Database> {
    const store = getRequestStore();
    if (store?.trx) {
      return store.trx;
    }
    return this.requireDb();
  }

  async getRequirements(locale = "en"): Promise<{
    documents: LegalDocumentVersionDto[];
    purposes: readonly ["marketing"];
  }> {
    return this.withApiRole(async (executor) => {
      const rows = await sql<{
        id: string;
        document_code: string;
        version: number;
        locale: string;
        sha256: string;
        published_at: Date;
        effective_at: Date;
      }>`
        SELECT DISTINCT ON (ld.document_code)
          ld.id,
          ld.document_code,
          ld.version,
          ld.locale,
          ld.sha256,
          ld.published_at,
          ld.effective_at
        FROM iam.legal_document_versions AS ld
        WHERE ld.document_code IN ('terms', 'privacy')
          AND ld.locale = ${locale}
          AND ld.retired_at IS NULL
          AND ld.effective_at <= now()
        ORDER BY ld.document_code, ld.version DESC, ld.published_at DESC
      `.execute(executor);

      return {
        documents: rows.rows.map((row) => ({
          id: row.id,
          documentCode: row.document_code as "terms" | "privacy",
          version: row.version,
          locale: row.locale,
          sha256: row.sha256,
          publishedAt: toIso(row.published_at),
          effectiveAt: toIso(row.effective_at),
        })),
        purposes: ["marketing"] as const,
      };
    });
  }

  async listCurrentConsents(userId: string): Promise<{ items: ConsentEventDto[] }> {
    return this.withApiRole(async (executor) => {
      const rows = await sql<{
        id: string;
        document_version_id: string | null;
        purpose_code: string;
        decision: ConsentDecision;
        source: string;
        occurred_at: Date;
      }>`
        SELECT DISTINCT ON (ce.purpose_code)
          ce.id,
          ce.document_version_id,
          ce.purpose_code,
          ce.decision,
          ce.source,
          ce.occurred_at
        FROM iam.consent_events AS ce
        WHERE ce.user_id = ${userId}::uuid
        ORDER BY ce.purpose_code, ce.occurred_at DESC, ce.id DESC
      `.execute(executor);

      return {
        items: rows.rows.map((row) => {
          const item: ConsentEventDto = {
            id: row.id,
            purposeCode: row.purpose_code as ConsentPurpose,
            decision: row.decision,
            source: row.source as ConsentSource | "admin",
            occurredAt: toIso(row.occurred_at),
          };
          if (row.document_version_id !== null) {
            return { ...item, documentVersionId: row.document_version_id };
          }
          return item;
        }),
      };
    }, userId);
  }

  private async withApiRole<T>(
    fn: (executor: Kysely<Database> | Transaction<Database>) => Promise<T>,
    userId?: string,
  ): Promise<T> {
    const store = getRequestStore();
    if (store?.trx) {
      return fn(store.trx);
    }
    const actorUserId = userId ?? store?.actor?.userId;
    if (!actorUserId) {
      throw new Error("ConsentService read requires an actor user id.");
    }
    return this.requireDb()
      .transaction()
      .execute(async (trx) => {
        await sql`SET LOCAL ROLE dm_api`.execute(trx);
        await sql`SELECT set_config('app.user_id', ${actorUserId}, true)`.execute(trx);
        const roles = store?.actor?.roles?.join(",") ?? "learner";
        await sql`SELECT set_config('app.roles', ${roles}, true)`.execute(trx);
        return fn(trx);
      });
  }

  async recordConsentEvents(
    userId: string,
    events: readonly ConsentEventInput[],
  ): Promise<{ items: ConsentEventDto[] }> {
    if (events.length < 1 || events.length > 3) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "events must contain between 1 and 3 items.",
      });
    }

    const store = requireRequestStore();
    const correlationId = store.requestId;
    const executor = this.trxOrDb();
    const created: ConsentEventDto[] = [];

    for (const event of events) {
      this.assertConsentInput(event);

      if (event.purposeCode === "terms" || event.purposeCode === "privacy") {
        const docId = event.documentVersionId;
        if (docId === undefined) {
          throw new BadRequestException({
            code: "validation_failed",
            detail: `${event.purposeCode} requires documentVersionId.`,
          });
        }
        const found = await sql<{ id: string; document_code: string }>`
          SELECT ld.id, ld.document_code
          FROM iam.legal_document_versions AS ld
          WHERE ld.id = ${docId}::uuid
            AND ld.retired_at IS NULL
        `.execute(executor);
        const doc = found.rows[0];
        if (!doc) {
          throw new NotFoundException({
            code: "not_found",
            detail: "Legal document version was not found.",
          });
        }
        if (doc.document_code !== event.purposeCode) {
          throw new BadRequestException({
            code: "validation_failed",
            detail: "documentVersionId does not match purposeCode.",
          });
        }
      }

      const id = createUuidV7();
      const inserted = await sql<{
        id: string;
        document_version_id: string | null;
        purpose_code: string;
        decision: ConsentDecision;
        source: string;
        occurred_at: Date;
      }>`
        INSERT INTO iam.consent_events (
          id,
          user_id,
          document_version_id,
          purpose_code,
          decision,
          source,
          correlation_id
        )
        VALUES (
          ${id}::uuid,
          ${userId}::uuid,
          ${event.documentVersionId ?? null}::uuid,
          ${event.purposeCode},
          ${event.decision}::iam.consent_decision,
          ${event.source},
          ${correlationId}::uuid
        )
        RETURNING
          id,
          document_version_id,
          purpose_code,
          decision,
          source,
          occurred_at
      `.execute(executor);

      const row = inserted.rows[0];
      if (!row) {
        throw new Error("consent insert returned no row");
      }
      const dto: ConsentEventDto = {
        id: row.id,
        purposeCode: row.purpose_code as ConsentPurpose,
        decision: row.decision,
        source: row.source as ConsentSource,
        occurredAt: toIso(row.occurred_at),
      };
      if (row.document_version_id !== null) {
        created.push({ ...dto, documentVersionId: row.document_version_id });
      } else {
        created.push(dto);
      }
    }

    return { items: created };
  }

  private assertConsentInput(event: ConsentEventInput): void {
    const purposes: ConsentPurpose[] = ["terms", "privacy", "marketing"];
    if (!purposes.includes(event.purposeCode)) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "Invalid purposeCode.",
      });
    }
    const decisions: ConsentDecision[] = ["granted", "withdrawn", "declined"];
    if (!decisions.includes(event.decision)) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "Invalid decision.",
      });
    }
    const sources: ConsentSource[] = ["web", "ios", "android"];
    if (!sources.includes(event.source)) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "Invalid source.",
      });
    }
    if (event.purposeCode === "marketing" && event.documentVersionId !== undefined) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "marketing consent must not include documentVersionId.",
      });
    }
    if (
      (event.purposeCode === "terms" || event.purposeCode === "privacy") &&
      event.documentVersionId === undefined
    ) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: `${event.purposeCode} requires documentVersionId.`,
      });
    }
  }
}
