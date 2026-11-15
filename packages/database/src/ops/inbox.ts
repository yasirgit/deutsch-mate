/**
 * Inbox consumer library: atomic claim + once-only effects (ADR-012).
 */

import { sha256Hex } from "@deutsch-mate/domain";
import { sql } from "kysely";

import type { OpsDb } from "./idempotency.js";

export const DEFAULT_INBOX_MAX_ATTEMPTS = 8;

export type InboxClaimResult<T> =
  | { readonly kind: "processed"; readonly result: T; readonly inboxId: string }
  | { readonly kind: "duplicate"; readonly result: unknown; readonly inboxId: string }
  | { readonly kind: "in_progress"; readonly inboxId: string };

export interface ConsumeInboxMessageInput<T> {
  readonly inboxId: string;
  readonly consumerName: string;
  readonly messageId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly maxAttempts?: number;
  /**
   * Side effects that must run in the same transaction as the inbox claim.
   * Invoked only when this consumer has not already processed `messageId`.
   */
  readonly effect: (db: OpsDb) => Promise<T>;
}

function payloadDigest(payload: unknown): string {
  return sha256Hex(JSON.stringify(payload ?? null));
}

/**
 * Atomically claims an inbox message and runs `effect` once.
 * Duplicate deliveries with the same (consumer_name, message_id) return the
 * prior result without re-running effects.
 */
export async function consumeInboxMessage<T>(
  db: OpsDb,
  input: ConsumeInboxMessageInput<T>,
): Promise<InboxClaimResult<T>> {
  if (input.consumerName.length === 0 || input.consumerName.length > 100) {
    throw new Error("consumeInboxMessage: consumerName must be 1–100 characters.");
  }

  const digest = payloadDigest(input.payload);
  const maxAttempts = input.maxAttempts ?? DEFAULT_INBOX_MAX_ATTEMPTS;

  const inserted = await sql<{ id: string }>`
    INSERT INTO ops.inbox_events (
      id, consumer_name, message_id, event_type, payload_sha256,
      received_at, status, attempt_count, created_at
    ) VALUES (
      ${input.inboxId}::uuid,
      ${input.consumerName},
      ${input.messageId}::uuid,
      ${input.eventType},
      ${digest},
      now(),
      'processing',
      1,
      now()
    )
    ON CONFLICT (consumer_name, message_id) DO NOTHING
    RETURNING id
  `.execute(db);

  if (inserted.rows[0]) {
    try {
      const result = await input.effect(db);
      await sql`
        UPDATE ops.inbox_events
        SET status = 'processed',
            processed_at = now(),
            result = ${JSON.stringify(result ?? null)}::jsonb,
            last_error = NULL
        WHERE id = ${input.inboxId}::uuid
      `.execute(db);
      return { kind: "processed", result, inboxId: input.inboxId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await sql`
        UPDATE ops.inbox_events
        SET status = CASE
              WHEN attempt_count >= ${maxAttempts} THEN 'dead_letter'
              ELSE 'failed'
            END,
            last_error = ${message.slice(0, 2000)},
            attempt_count = attempt_count
        WHERE id = ${input.inboxId}::uuid
      `.execute(db);
      throw error;
    }
  }

  const existing = await sql<{
    id: string;
    status: string;
    result: unknown;
    attempt_count: number;
  }>`
    SELECT id, status, result, attempt_count
    FROM ops.inbox_events
    WHERE consumer_name = ${input.consumerName}
      AND message_id = ${input.messageId}::uuid
    FOR UPDATE
  `.execute(db);

  const row = existing.rows[0];
  if (!row) {
    throw new Error("consumeInboxMessage: conflict without existing row.");
  }

  if (row.status === "processed") {
    return { kind: "duplicate", result: row.result, inboxId: row.id };
  }

  if (row.status === "processing") {
    return { kind: "in_progress", inboxId: row.id };
  }

  if (row.status === "dead_letter") {
    return { kind: "duplicate", result: row.result, inboxId: row.id };
  }

  // Reclaim failed rows under the attempt budget.
  if (row.attempt_count >= maxAttempts) {
    await sql`
      UPDATE ops.inbox_events
      SET status = 'dead_letter',
          last_error = COALESCE(last_error, 'max attempts exceeded')
      WHERE id = ${row.id}::uuid
    `.execute(db);
    return { kind: "duplicate", result: row.result, inboxId: row.id };
  }

  await sql`
    UPDATE ops.inbox_events
    SET status = 'processing',
        attempt_count = attempt_count + 1,
        last_error = NULL
    WHERE id = ${row.id}::uuid
  `.execute(db);

  try {
    const result = await input.effect(db);
    await sql`
      UPDATE ops.inbox_events
      SET status = 'processed',
          processed_at = now(),
          result = ${JSON.stringify(result ?? null)}::jsonb,
          last_error = NULL
      WHERE id = ${row.id}::uuid
    `.execute(db);
    return { kind: "processed", result, inboxId: row.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`
      UPDATE ops.inbox_events
      SET status = CASE
            WHEN attempt_count >= ${maxAttempts} THEN 'dead_letter'
            ELSE 'failed'
          END,
          last_error = ${message.slice(0, 2000)}
      WHERE id = ${row.id}::uuid
    `.execute(db);
    throw error;
  }
}

/**
 * Marks a dead-letter inbox row pending reprocessing (replay tooling).
 */
export async function replayInboxMessage(
  db: OpsDb,
  consumerName: string,
  messageId: string,
): Promise<void> {
  const result = await sql`
    UPDATE ops.inbox_events
    SET status = 'failed',
        attempt_count = 0,
        last_error = NULL,
        processed_at = NULL
    WHERE consumer_name = ${consumerName}
      AND message_id = ${messageId}::uuid
      AND status = 'dead_letter'
  `.execute(db);

  if (Number(result.numAffectedRows ?? 0) !== 1) {
    throw new Error(
      `replayInboxMessage: no dead_letter row for ${consumerName}/${messageId}.`,
    );
  }
}
