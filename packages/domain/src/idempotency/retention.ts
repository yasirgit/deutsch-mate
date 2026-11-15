/**
 * Idempotency key retention windows (docs/API.md; docs/Database.md).
 * Attempts and purchases: 400 days; other commands: 24 hours.
 */

export const IDEMPOTENCY_RETENTION = {
  attemptsAndPurchasesMs: 400 * 24 * 60 * 60 * 1000,
  defaultMs: 24 * 60 * 60 * 1000,
} as const;

export type IdempotencyRetentionKind = "attempt" | "purchase" | "default";

export function idempotencyRetentionMs(kind: IdempotencyRetentionKind): number {
  switch (kind) {
    case "attempt":
    case "purchase":
      return IDEMPOTENCY_RETENTION.attemptsAndPurchasesMs;
    case "default":
      return IDEMPOTENCY_RETENTION.defaultMs;
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled retention kind: ${String(exhaustive)}`);
    }
  }
}

export function expiresAtFromNow(
  kind: IdempotencyRetentionKind,
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() + idempotencyRetentionMs(kind));
}
