/**
 * Append-only audit integrity hashing (docs/Database.md ops.audit_events).
 * Chains event_hash ← previous_hash for tamper-evident export.
 */

import { canonicalizeJson } from "../idempotency/canonicalize.js";
import { sha256Hex } from "../idempotency/hash.js";

export type AuditActorType = "user" | "staff" | "service" | "provider";
export type AuditOutcome = "success" | "denied" | "failed";

export interface AuditHashInput {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorUserId: string | null;
  readonly actorType: AuditActorType;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly outcome: AuditOutcome;
  readonly reasonCode: string | null;
  readonly correlationId: string;
  readonly metadata: unknown;
  readonly previousHash: string | null;
}

/**
 * Computes `event_hash` over the canonical audit payload including
 * `previous_hash` (null for the first event in a chain/day).
 */
export function computeAuditEventHash(input: AuditHashInput): string {
  return sha256Hex(
    canonicalizeJson({
      id: input.id,
      occurredAt: input.occurredAt,
      actorUserId: input.actorUserId,
      actorType: input.actorType,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: input.outcome,
      reasonCode: input.reasonCode,
      correlationId: input.correlationId,
      metadata: input.metadata,
      previousHash: input.previousHash,
    }),
  );
}

/**
 * Verifies that `eventHash` matches the hash computed from `input`.
 */
export function verifyAuditEventHash(input: AuditHashInput, eventHash: string): boolean {
  return computeAuditEventHash(input) === eventHash;
}
