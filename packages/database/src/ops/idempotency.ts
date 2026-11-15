/**
 * Persistence helpers for ops.idempotency_keys (docs/Database.md; docs/API.md).
 * Claim/complete/conflict semantics; no Nest imports.
 */

import {
  assertIdempotencyKey,
  isSha256Hex,
  type IdempotencyOutcome,
  type IdempotencyRetentionKind,
  expiresAtFromNow,
} from "@deutsch-mate/domain";
import { sql, type Kysely, type Transaction } from "kysely";

import type { Database } from "../kysely.js";

export type OpsDb = Kysely<Database> | Transaction<Database>;

const DEFAULT_LOCK_MS = 30_000;

export interface ClaimIdempotencyKeyInput {
  readonly id: string;
  readonly scope: string;
  readonly actorUserId: string | null;
  readonly key: string;
  readonly requestHash: string;
  readonly retention: IdempotencyRetentionKind;
  readonly lockMs?: number;
  readonly now?: Date;
}

export interface CompleteIdempotencyKeyInput {
  readonly id: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
}

function asJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * Claims an idempotency key for a mutating command.
 * Same actor/scope/key + same hash → replay completed response.
 * Same key + different hash → conflict (API 409 idempotency_conflict).
 */
export async function claimIdempotencyKey(
  db: OpsDb,
  input: ClaimIdempotencyKeyInput,
): Promise<IdempotencyOutcome> {
  assertIdempotencyKey(input.key);
  if (!isSha256Hex(input.requestHash)) {
    throw new Error("claimIdempotencyKey: requestHash must be 64-char lowercase hex.");
  }
  if (input.scope.length === 0 || input.scope.length > 60) {
    throw new Error("claimIdempotencyKey: scope must be 1–60 characters.");
  }

  const now = input.now ?? new Date();
  const lockMs = input.lockMs ?? DEFAULT_LOCK_MS;
  const lockedUntil = new Date(now.getTime() + lockMs);
  const expiresAt = expiresAtFromNow(input.retention, now);

  const inserted = await sql<{ id: string }>`
    INSERT INTO ops.idempotency_keys (
      id, scope, actor_user_id, key, request_hash, state,
      locked_until, expires_at, created_at, updated_at
    ) VALUES (
      ${input.id}::uuid,
      ${input.scope},
      ${input.actorUserId}::uuid,
      ${input.key},
      ${input.requestHash},
      'processing',
      ${lockedUntil.toISOString()}::timestamptz,
      ${expiresAt.toISOString()}::timestamptz,
      ${now.toISOString()}::timestamptz,
      ${now.toISOString()}::timestamptz
    )
    ON CONFLICT (scope, actor_user_id, key) DO NOTHING
    RETURNING id
  `.execute(db);

  if ((inserted.rows[0]?.id ?? null) !== null) {
    return { kind: "acquired", id: input.id };
  }

  const existing = await sql<{
    id: string;
    request_hash: string;
    state: string;
    response_status: number | null;
    response_body: unknown;
    resource_type: string | null;
    resource_id: string | null;
    locked_until: Date;
  }>`
    SELECT id, request_hash, state, response_status, response_body,
           resource_type, resource_id, locked_until
    FROM ops.idempotency_keys
    WHERE scope = ${input.scope}
      AND key = ${input.key}
      AND actor_user_id IS NOT DISTINCT FROM ${input.actorUserId}::uuid
    FOR UPDATE
  `.execute(db);

  const row = existing.rows[0];
  if (!row) {
    throw new Error("claimIdempotencyKey: conflict without existing row.");
  }

  if (row.request_hash !== input.requestHash) {
    return { kind: "conflict", id: row.id };
  }

  if (row.state === "completed" && row.response_status !== null) {
    return {
      kind: "replay",
      id: row.id,
      responseStatus: row.response_status,
      responseBody: row.response_body,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
    };
  }

  const lockedUntilMs = new Date(row.locked_until).getTime();
  if (row.state === "processing" && lockedUntilMs > now.getTime()) {
    return { kind: "in_progress", id: row.id };
  }

  // Reclaim expired processing / failed keys with matching hash.
  await sql`
    UPDATE ops.idempotency_keys
    SET state = 'processing',
        locked_until = ${lockedUntil.toISOString()}::timestamptz,
        expires_at = ${expiresAt.toISOString()}::timestamptz,
        updated_at = ${now.toISOString()}::timestamptz,
        response_status = NULL,
        response_body = NULL,
        resource_type = NULL,
        resource_id = NULL
    WHERE id = ${row.id}::uuid
  `.execute(db);

  return { kind: "acquired", id: row.id };
}

export async function completeIdempotencyKey(
  db: OpsDb,
  input: CompleteIdempotencyKeyInput,
): Promise<void> {
  const result = await sql`
    UPDATE ops.idempotency_keys
    SET state = 'completed',
        response_status = ${input.responseStatus},
        response_body = ${asJson(input.responseBody)}::jsonb,
        resource_type = ${input.resourceType ?? null},
        resource_id = ${input.resourceId ?? null}::uuid,
        updated_at = now()
    WHERE id = ${input.id}::uuid
      AND state = 'processing'
  `.execute(db);

  if (Number(result.numAffectedRows ?? 0) !== 1) {
    throw new Error(`completeIdempotencyKey: expected one processing row for ${input.id}.`);
  }
}

export async function failIdempotencyKey(
  db: OpsDb,
  id: string,
  responseStatus: number,
  responseBody: unknown,
): Promise<void> {
  await sql`
    UPDATE ops.idempotency_keys
    SET state = 'failed',
        response_status = ${responseStatus},
        response_body = ${asJson(responseBody)}::jsonb,
        updated_at = now()
    WHERE id = ${id}::uuid
      AND state = 'processing'
  `.execute(db);
}
