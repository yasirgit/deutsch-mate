/**
 * Opens a request-bound DB transaction with RLS app context for mutating
 * routes that declare `@RequireIdempotency` (or `@Transactional`).
 * Correlation ID is the request ID (NFR-011; ADR-018).
 *
 * `@SerializableIsolation` sets SERIALIZABLE before other statements and
 * retries the whole transaction on SQLSTATE 40001 (bounded; Database.md §6).
 */

import {
  Inject,
  Injectable,
  Optional,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { OpsDb, Database } from "@deutsch-mate/database";
import { sql, type Kysely, type Transaction } from "kysely";
import { from, lastValueFrom, type Observable } from "rxjs";

import { KYSELY, type KyselyToken } from "./database.tokens.js";
import { IDEMPOTENCY_META_KEY } from "./idempotency/idempotency.interceptor.js";
import { requireRequestStore } from "./request-context.js";

export const TRANSACTIONAL_META_KEY = "dm:transactional";
export const SERIALIZABLE_META_KEY = "dm:serializable";

/** Default bounded retries for SERIALIZABLE publication conflicts. */
export const SERIALIZABLE_MAX_ATTEMPTS = 3;

/** Marks a handler to run inside a DB transaction with app context. */
export const Transactional = (): MethodDecorator => SetMetadata(TRANSACTIONAL_META_KEY, true);

/**
 * Marks a mutating handler to use SERIALIZABLE isolation with bounded retry
 * on serialization failures (release publication / entitlement ranges).
 */
export const SerializableIsolation = (): MethodDecorator =>
  SetMetadata(SERIALIZABLE_META_KEY, true);

function isSerializationFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? String((error as { code: unknown }).code) : "";
  return code === "40001";
}

@Injectable()
export class RequestTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(KYSELY) private readonly db: KyselyToken | null,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const needsTxn =
      this.reflector.getAllAndOverride<unknown>(IDEMPOTENCY_META_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) !== undefined ||
      this.reflector.getAllAndOverride<boolean>(TRANSACTIONAL_META_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    if (!needsTxn) {
      return next.handle();
    }
    if (!this.db) {
      throw new Error("Request transaction requires a configured database (DATABASE_URL).");
    }

    const serializable =
      this.reflector.getAllAndOverride<boolean>(SERIALIZABLE_META_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    const db: Kysely<Database> = this.db;
    const maxAttempts = serializable ? SERIALIZABLE_MAX_ATTEMPTS : 1;

    return from(
      (async (): Promise<unknown> => {
        let lastError: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            return await db.transaction().execute(async (trx: Transaction<Database>) => {
              const store = requireRequestStore();
              const actor = store.actor;
              if (!actor) {
                throw new Error(
                  "Request transaction requires an authenticated actor (OIDC or X-DM-Test-Actor).",
                );
              }

              if (serializable) {
                await sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`.execute(trx);
              }

              await sql`SET LOCAL ROLE dm_api`.execute(trx);
              await sql`SELECT set_config('app.user_id', ${actor.userId}, true)`.execute(trx);
              await sql`SELECT set_config('app.roles', ${actor.roles.join(",")}, true)`.execute(
                trx,
              );
              await sql`SELECT set_config('app.correlation_id', ${store.requestId}, true)`.execute(
                trx,
              );

              store.trx = trx;
              try {
                return await lastValueFrom(next.handle());
              } finally {
                store.trx = null;
              }
            });
          } catch (error) {
            lastError = error;
            if (!serializable || !isSerializationFailure(error) || attempt >= maxAttempts) {
              throw error;
            }
          }
        }
        throw lastError;
      })(),
    );
  }
}

/**
 * Idempotency DB resolver: returns the request transaction opened by
 * RequestTransactionInterceptor.
 */
export function createIdempotencyDbResolver(): {
  getDb: () => OpsDb;
} {
  return {
    getDb: (): OpsDb => {
      const store = requireRequestStore();
      if (!store.trx) {
        throw new Error("Idempotency DB resolver requires an active request transaction.");
      }
      return store.trx;
    },
  };
}
