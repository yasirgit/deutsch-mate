/**
 * Persistence adapter package (Kysely + node-postgres).
 *
 * No domain logic lives here. Schema is owned by explicit SQL under
 * `migrations/` (ADR-009; docs/CODING_STANDARDS.md §10). Runtime DDL and
 * ORM auto-sync are forbidden.
 */

export { createPgPool, type PgPoolConfig } from "./pool.js";
export { createKysely, type Database } from "./kysely.js";
export type { Transaction } from "./kysely.js";
export type * from "./generated/index.js";
export {
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  formatPgTimeout,
  type MigrationTimeouts,
} from "./timeouts.js";
export {
  APP_ROLE_CODES,
  clearTransactionAppContext,
  setTransactionAppContext,
  withTransactionAppContext,
  type AppRoleCode,
  type PgQueryable,
  type TransactionAppContext,
} from "./transaction-context.js";
export {
  claimIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  DEFAULT_OUTBOX_LOCK_MS,
  DEFAULT_OUTBOX_MAX_ATTEMPTS,
  claimOutboxBatch,
  insertOutboxEvent,
  markOutboxFailed,
  markOutboxPublished,
  outboxRowToEnvelope,
  replayOutboxEvent,
  DEFAULT_INBOX_MAX_ATTEMPTS,
  consumeInboxMessage,
  replayInboxMessage,
  appendAuditEvent,
  exportAuditEvents,
  type ClaimIdempotencyKeyInput,
  type CompleteIdempotencyKeyInput,
  type OpsDb,
  type ClaimOutboxBatchOptions,
  type InsertOutboxEventInput,
  type OutboxRow,
  type ConsumeInboxMessageInput,
  type InboxClaimResult,
  type AppendAuditEventInput,
  type AuditEventRow,
  type AuditExportManifest,
} from "./ops/index.js";
export {
  applyMigrations,
  discoverMigrationFiles,
  MIGRATION_FILE_PATTERN,
  MIGRATOR_ROLE,
  RUNTIME_LOGIN_ROLES,
  sha256Hex,
  verifyMigrations,
  type ApplyMigrationsOptions,
  type ApplyMigrationsResult,
  type DiscoveredMigration,
  type MigrationActorContext,
  type VerifyMigrationsResult,
} from "./migrate/index.js";
