/**
 * Transactional outbox insert + publisher claim helpers (ADR-012).
 * Business mutation and insertOutboxEvent must share one transaction.
 */

import { isUuidV7, parseDomainEventEnvelope, type DomainEventEnvelope } from "@deutsch-mate/domain";
import { sql } from "kysely";

import type { OpsDb } from "./idempotency.js";

export const DEFAULT_OUTBOX_MAX_ATTEMPTS = 8;
export const DEFAULT_OUTBOX_LOCK_MS = 60_000;

export interface InsertOutboxEventInput {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: Record<string, unknown>;
  readonly headers?: Record<string, unknown>;
  readonly correlationId: string;
  readonly causationId?: string | null;
  readonly occurredAt?: Date;
  readonly availableAt?: Date;
}

export interface OutboxRow {
  readonly id: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly event_type: string;
  readonly event_version: number;
  readonly payload: unknown;
  readonly headers: unknown;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly occurred_at: Date;
  readonly available_at: Date;
  readonly status: string;
  readonly attempt_count: number;
  readonly locked_until: Date | null;
  readonly published_at: Date | null;
  readonly last_error: string | null;
  readonly created_at: Date;
}

function asJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

/**
 * Inserts an outbox row. Call inside the same transaction as the business write.
 */
export async function insertOutboxEvent(
  db: OpsDb,
  input: InsertOutboxEventInput,
): Promise<DomainEventEnvelope> {
  if (!isUuidV7(input.id) && !/^[0-9a-f-]{36}$/i.test(input.id)) {
    throw new Error("insertOutboxEvent: id must be a UUID.");
  }
  const occurredAt = input.occurredAt ?? new Date();
  const availableAt = input.availableAt ?? occurredAt;
  const headers = input.headers ?? {};
  const occurredIso = occurredAt.toISOString();
  const availableIso = availableAt.toISOString();

  const envelope = parseDomainEventEnvelope({
    eventId: input.id,
    eventType: input.eventType,
    eventVersion: input.eventVersion,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    occurredAt: occurredIso,
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    payload: input.payload,
    headers,
  });

  await sql`
    INSERT INTO ops.outbox_events (
      id, aggregate_type, aggregate_id, event_type, event_version,
      payload, headers, correlation_id, causation_id, occurred_at, available_at,
      status, attempt_count, created_at
    ) VALUES (
      ${input.id}::uuid,
      ${input.aggregateType},
      ${input.aggregateId}::uuid,
      ${input.eventType},
      ${input.eventVersion},
      ${asJson(input.payload)}::jsonb,
      ${asJson(headers)}::jsonb,
      ${input.correlationId}::uuid,
      ${input.causationId ?? null}::uuid,
      ${occurredIso}::timestamptz,
      ${availableIso}::timestamptz,
      'pending',
      0,
      now()
    )
  `.execute(db);

  return envelope;
}

export interface ClaimOutboxBatchOptions {
  readonly batchSize?: number;
  readonly lockMs?: number;
  readonly maxAttempts?: number;
}

/**
 * Claims unpublished outbox rows with FOR UPDATE SKIP LOCKED.
 * Moves exhausted retries to dead_letter.
 */
export async function claimOutboxBatch(
  db: OpsDb,
  options: ClaimOutboxBatchOptions = {},
): Promise<OutboxRow[]> {
  const batchSize = options.batchSize ?? 10;
  const lockMs = options.lockMs ?? DEFAULT_OUTBOX_LOCK_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_OUTBOX_MAX_ATTEMPTS;

  await sql`
    UPDATE ops.outbox_events
    SET status = 'dead_letter',
        last_error = COALESCE(last_error, 'max attempts exceeded'),
        locked_until = NULL
    WHERE status IN ('pending', 'failed')
      AND attempt_count >= ${maxAttempts}
      AND (locked_until IS NULL OR locked_until < now())
  `.execute(db);

  const claimed = await sql<OutboxRow>`
    UPDATE ops.outbox_events AS o
    SET status = 'publishing',
        attempt_count = o.attempt_count + 1,
        locked_until = now() + (${lockMs} || ' milliseconds')::interval,
        last_error = NULL
    WHERE o.id IN (
      SELECT id
      FROM ops.outbox_events
      WHERE status IN ('pending', 'failed')
        AND available_at <= now()
        AND attempt_count < ${maxAttempts}
        AND (locked_until IS NULL OR locked_until < now())
      ORDER BY available_at ASC, occurred_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${batchSize}
    )
    RETURNING
      o.id, o.aggregate_type, o.aggregate_id, o.event_type, o.event_version,
      o.payload, o.headers, o.correlation_id, o.causation_id, o.occurred_at,
      o.available_at, o.status, o.attempt_count, o.locked_until, o.published_at,
      o.last_error, o.created_at
  `.execute(db);

  return [...claimed.rows];
}

export async function markOutboxPublished(db: OpsDb, id: string): Promise<void> {
  await sql`
    UPDATE ops.outbox_events
    SET status = 'published',
        published_at = now(),
        locked_until = NULL,
        last_error = NULL
    WHERE id = ${id}::uuid
      AND status = 'publishing'
  `.execute(db);
}

export async function markOutboxFailed(
  db: OpsDb,
  id: string,
  error: string,
  options: { readonly deadLetter?: boolean; readonly retryDelayMs?: number } = {},
): Promise<void> {
  const status = options.deadLetter === true ? "dead_letter" : "failed";
  const delayMs = options.retryDelayMs ?? 5_000;
  await sql`
    UPDATE ops.outbox_events
    SET status = ${status}::ops.delivery_status,
        last_error = ${error.slice(0, 2000)},
        locked_until = NULL,
        available_at = CASE
          WHEN ${status} = 'failed' THEN now() + (${delayMs} || ' milliseconds')::interval
          ELSE available_at
        END
    WHERE id = ${id}::uuid
      AND status = 'publishing'
  `.execute(db);
}

/**
 * Requeues a dead-letter (or failed) row for replay tooling.
 */
export async function replayOutboxEvent(db: OpsDb, id: string): Promise<void> {
  const result = await sql`
    UPDATE ops.outbox_events
    SET status = 'pending',
        attempt_count = 0,
        locked_until = NULL,
        last_error = NULL,
        available_at = now(),
        published_at = NULL
    WHERE id = ${id}::uuid
      AND status IN ('dead_letter', 'failed', 'published')
  `.execute(db);

  if (Number(result.numAffectedRows ?? 0) !== 1) {
    throw new Error(`replayOutboxEvent: no replayable row for ${id}.`);
  }
}

export function outboxRowToEnvelope(row: OutboxRow): DomainEventEnvelope {
  const occurred =
    row.occurred_at instanceof Date
      ? row.occurred_at.toISOString()
      : String(row.occurred_at);

  return parseDomainEventEnvelope({
    eventId: row.id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    occurredAt: occurred,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    payload:
      typeof row.payload === "object" && row.payload !== null && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
    headers:
      typeof row.headers === "object" && row.headers !== null && !Array.isArray(row.headers)
        ? (row.headers as Record<string, unknown>)
        : {},
  });
}
