/**
 * Append-only audit events with hash chaining (docs/Database.md).
 */

import {
  computeAuditEventHash,
  createUuidV7,
  type AuditActorType,
  type AuditOutcome,
} from "@deutsch-mate/domain";
import { sql } from "kysely";

import type { OpsDb } from "./idempotency.js";

export interface AppendAuditEventInput {
  readonly id?: string;
  readonly occurredAt?: Date;
  readonly actorUserId?: string | null;
  readonly actorType: AuditActorType;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string | null;
  readonly outcome: AuditOutcome;
  readonly reasonCode?: string | null;
  readonly correlationId: string;
  readonly ipHash?: Buffer | null;
  readonly metadata?: Record<string, unknown>;
}

export interface AuditEventRow {
  readonly id: string;
  readonly occurred_at: Date;
  readonly actor_user_id: string | null;
  readonly actor_type: string;
  readonly action: string;
  readonly resource_type: string;
  readonly resource_id: string | null;
  readonly outcome: string;
  readonly reason_code: string | null;
  readonly correlation_id: string;
  readonly metadata: unknown;
  readonly previous_hash: string | null;
  readonly event_hash: string;
  readonly created_at: Date;
}

/**
 * Appends an audit event, chaining `previous_hash` from the latest row.
 * Must not include raw learner content, tokens, secrets, or signed URLs in metadata.
 */
export async function appendAuditEvent(
  db: OpsDb,
  input: AppendAuditEventInput,
): Promise<AuditEventRow> {
  const id = input.id ?? createUuidV7();
  const occurredAt = input.occurredAt ?? new Date();
  const metadata = input.metadata ?? {};

  // Serialize appenders without requiring UPDATE on append-only audit_events
  // (SELECT ... FOR UPDATE needs UPDATE; dm_api only has SELECT+INSERT).
  await sql`SELECT pg_advisory_xact_lock(hashtext('ops.audit_events'))`.execute(db);

  const latest = await sql<{ event_hash: string }>`
    SELECT event_hash
    FROM ops.audit_events
    ORDER BY occurred_at DESC, id DESC
    LIMIT 1
  `.execute(db);

  const previousHash = latest.rows[0]?.event_hash ?? null;
  const occurredIso = occurredAt.toISOString();
  const eventHash = computeAuditEventHash({
    id,
    occurredAt: occurredIso,
    actorUserId: input.actorUserId ?? null,
    actorType: input.actorType,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    outcome: input.outcome,
    reasonCode: input.reasonCode ?? null,
    correlationId: input.correlationId,
    metadata,
    previousHash,
  });

  const inserted = await sql<AuditEventRow>`
    INSERT INTO ops.audit_events (
      id, occurred_at, actor_user_id, actor_type, action, resource_type, resource_id,
      outcome, reason_code, correlation_id, ip_hash, metadata, previous_hash, event_hash,
      created_at
    ) VALUES (
      ${id}::uuid,
      ${occurredIso}::timestamptz,
      ${input.actorUserId ?? null}::uuid,
      ${input.actorType},
      ${input.action},
      ${input.resourceType},
      ${input.resourceId ?? null}::uuid,
      ${input.outcome},
      ${input.reasonCode ?? null},
      ${input.correlationId}::uuid,
      ${input.ipHash ?? null},
      ${JSON.stringify(metadata)}::jsonb,
      ${previousHash},
      ${eventHash},
      now()
    )
    RETURNING
      id, occurred_at, actor_user_id, actor_type, action, resource_type, resource_id,
      outcome, reason_code, correlation_id, metadata, previous_hash, event_hash, created_at
  `.execute(db);

  const row = inserted.rows[0];
  if (!row) {
    throw new Error("appendAuditEvent: insert returned no row.");
  }
  return row;
}

export interface AuditExportManifest {
  readonly exportedAt: string;
  readonly fromOccurredAt: string | null;
  readonly toOccurredAt: string | null;
  readonly eventCount: number;
  readonly firstEventHash: string | null;
  readonly lastEventHash: string | null;
  readonly chainValid: boolean;
  readonly events: readonly AuditEventRow[];
}

/**
 * Loads audit events for a time window and verifies the hash chain.
 * Production uploads a signed daily manifest to S3 Object Lock (stub here).
 */
export async function exportAuditEvents(
  db: OpsDb,
  options: {
    readonly fromOccurredAt?: Date;
    readonly toOccurredAt?: Date;
    readonly limit?: number;
  } = {},
): Promise<AuditExportManifest> {
  const limit = options.limit ?? 10_000;
  const from = options.fromOccurredAt?.toISOString() ?? null;
  const to = options.toOccurredAt?.toISOString() ?? null;

  const rows = await sql<AuditEventRow>`
    SELECT
      id, occurred_at, actor_user_id, actor_type, action, resource_type, resource_id,
      outcome, reason_code, correlation_id, metadata, previous_hash, event_hash, created_at
    FROM ops.audit_events
    WHERE (${from}::timestamptz IS NULL OR occurred_at >= ${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR occurred_at < ${to}::timestamptz)
    ORDER BY occurred_at ASC, id ASC
    LIMIT ${limit}
  `.execute(db);

  const events = [...rows.rows];
  let chainValid = true;

  for (const event of events) {
    const occurredIso =
      event.occurred_at instanceof Date
        ? event.occurred_at.toISOString()
        : String(event.occurred_at);
    const recomputed = computeAuditEventHash({
      id: event.id,
      occurredAt: occurredIso,
      actorUserId: event.actor_user_id,
      actorType: event.actor_type as AuditActorType,
      action: event.action,
      resourceType: event.resource_type,
      resourceId: event.resource_id,
      outcome: event.outcome as AuditOutcome,
      reasonCode: event.reason_code,
      correlationId: event.correlation_id,
      metadata: event.metadata,
      previousHash: event.previous_hash,
    });
    if (recomputed !== event.event_hash) {
      chainValid = false;
      break;
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    fromOccurredAt: from,
    toOccurredAt: to,
    eventCount: events.length,
    firstEventHash: events[0]?.event_hash ?? null,
    lastEventHash: events[events.length - 1]?.event_hash ?? null,
    chainValid,
    events,
  };
}
