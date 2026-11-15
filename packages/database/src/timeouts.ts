/** Default lock wait before aborting a migration statement (local-friendly). */
export const DEFAULT_LOCK_TIMEOUT_MS = 5_000;

/** Default statement runtime budget for a single migration transaction. */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 60_000;

export interface MigrationTimeouts {
  readonly lockTimeoutMs: number;
  readonly statementTimeoutMs: number;
}

/**
 * Formats a millisecond duration for PostgreSQL `SET LOCAL *_timeout`.
 * Values must be finite and non-negative.
 */
export function formatPgTimeout(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`Timeout must be a non-negative finite number of ms, got ${String(ms)}.`);
  }
  return `${Math.trunc(ms)}ms`;
}
