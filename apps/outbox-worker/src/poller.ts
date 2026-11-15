/**
 * Claims unpublished outbox rows and publishes via the configured transport.
 *
 * Claim commits before publish so a crash after EventBridge accept still
 * yields at-least-once delivery; inbox consumers make effects once-only.
 */

import {
  claimOutboxBatch,
  markOutboxFailed,
  markOutboxPublished,
  outboxRowToEnvelope,
  type OpsDb,
  type OutboxRow,
} from "@deutsch-mate/database";

import type { EventPublisher } from "./publisher.js";

export interface OutboxPollCycleResult {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
  readonly deadLetter: number;
}

export async function runOutboxPollCycle(
  db: OpsDb,
  publisher: EventPublisher,
  options: {
    readonly batchSize?: number;
    readonly maxAttempts?: number;
  } = {},
): Promise<OutboxPollCycleResult> {
  const claimOptions: { batchSize?: number; maxAttempts?: number } = {};
  if (options.batchSize !== undefined) {
    claimOptions.batchSize = options.batchSize;
  }
  if (options.maxAttempts !== undefined) {
    claimOptions.maxAttempts = options.maxAttempts;
  }
  const rows: OutboxRow[] = await claimOutboxBatch(db, claimOptions);

  let published = 0;
  let failed = 0;
  let deadLetter = 0;
  const maxAttempts = options.maxAttempts ?? 8;

  for (const row of rows) {
    try {
      const envelope = outboxRowToEnvelope(row);
      await publisher.publish(envelope);
      await markOutboxPublished(db, row.id);
      published += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const exhaust = row.attempt_count >= maxAttempts;
      await markOutboxFailed(db, row.id, message, { deadLetter: exhaust });
      if (exhaust) {
        deadLetter += 1;
      } else {
        failed += 1;
      }
    }
  }

  return {
    claimed: rows.length,
    published,
    failed,
    deadLetter,
  };
}
