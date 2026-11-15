/**
 * Transaction-local authorization context (docs/Database.md §8).
 *
 * Values come from verified OIDC claims + database role lookup — never from
 * request fields that select another user. Uses SET LOCAL via set_config(..., true).
 */

import { sql, type Kysely, type Transaction } from "kysely";

import type { Database } from "./kysely.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ROLE_RE = /^[a-z][a-z0-9_]{0,62}$/;

/** Closed allowlist aligned with iam.role_code. */
export const APP_ROLE_CODES = [
  "learner",
  "content_editor",
  "content_reviewer",
  "support",
  "privacy_operator",
  "billing_operator",
  "admin",
] as const;

export type AppRoleCode = (typeof APP_ROLE_CODES)[number];

export interface TransactionAppContext {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly correlationId: string;
}

export type PgQueryable = {
  query: (queryText: string, values?: readonly unknown[]) => Promise<unknown>;
};

function assertUuid(label: string, value: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`Invalid ${label}: expected UUID, got "${value}".`);
  }
}

function normalizeRoles(roles: readonly string[]): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const role of roles) {
    if (!ROLE_RE.test(role)) {
      throw new Error(`Invalid app role "${role}".`);
    }
    if (!seen.has(role)) {
      seen.add(role);
      unique.push(role);
    }
  }
  return unique.join(",");
}

/**
 * Sets `app.user_id`, `app.roles`, and `app.correlation_id` for the current
 * transaction (SET LOCAL semantics via set_config is_local=true).
 */
export async function setTransactionAppContext(
  client: PgQueryable,
  context: TransactionAppContext,
): Promise<void> {
  assertUuid("userId", context.userId);
  assertUuid("correlationId", context.correlationId);
  const rolesCsv = normalizeRoles(context.roles);

  await client.query(`SELECT set_config('app.user_id', $1, true)`, [context.userId]);
  await client.query(`SELECT set_config('app.roles', $1, true)`, [rolesCsv]);
  await client.query(`SELECT set_config('app.correlation_id', $1, true)`, [
    context.correlationId,
  ]);
}

/**
 * Clears transaction-local app context (empty strings → nullif in policies).
 */
export async function clearTransactionAppContext(client: PgQueryable): Promise<void> {
  await client.query(`SELECT set_config('app.user_id', '', true)`);
  await client.query(`SELECT set_config('app.roles', '', true)`);
  await client.query(`SELECT set_config('app.correlation_id', '', true)`);
}

async function setContextOnKysely(
  trx: Transaction<Database> | Kysely<Database>,
  context: TransactionAppContext,
): Promise<void> {
  assertUuid("userId", context.userId);
  assertUuid("correlationId", context.correlationId);
  const rolesCsv = normalizeRoles(context.roles);

  await sql`SELECT set_config('app.user_id', ${context.userId}, true)`.execute(trx);
  await sql`SELECT set_config('app.roles', ${rolesCsv}, true)`.execute(trx);
  await sql`SELECT set_config('app.correlation_id', ${context.correlationId}, true)`.execute(
    trx,
  );
}

/**
 * Runs `fn` inside a Kysely transaction after applying transaction-local
 * authorization context.
 */
export async function withTransactionAppContext<T>(
  db: Kysely<Database>,
  context: TransactionAppContext,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await setContextOnKysely(trx, context);
    return fn(trx);
  });
}
