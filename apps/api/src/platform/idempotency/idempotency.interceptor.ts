/**
 * NestJS Idempotency-Key interceptor skeleton (docs/API.md; OpenAPI IdempotencyKey).
 *
 * Activates when handler metadata `idempotency` is set (scope + retention).
 * Full platform wiring (auth actor, Problem Details filter) lands with DM-026;
 * this interceptor provides the reusable claim/replay/conflict path.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  assertIdempotencyKey,
  createUuidV7,
  hashCanonicalRequest,
  isIdempotencyKey,
  type IdempotencyRetentionKind,
} from "@deutsch-mate/domain";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  type OpsDb,
} from "@deutsch-mate/database";
import { Observable, from, of, throwError } from "rxjs";
import { catchError, mergeMap, tap } from "rxjs/operators";

export const IDEMPOTENCY_META_KEY = "dm:idempotency";

export interface IdempotencyRouteMeta {
  readonly scope: string;
  readonly retention: IdempotencyRetentionKind;
}

/** Marks a mutating route as requiring Idempotency-Key (OpenAPI contract). */
export const RequireIdempotency = (meta: IdempotencyRouteMeta): MethodDecorator =>
  SetMetadata(IDEMPOTENCY_META_KEY, meta);

export interface IdempotencyActorResolver {
  resolveActorUserId(context: ExecutionContext): string | null;
}

export interface IdempotencyDbResolver {
  /**
   * Returns a transactional OpsDb bound to the current request.
   * Production wiring opens a transaction around the handler (DM-026).
   */
  getDb(context: ExecutionContext): OpsDb | Promise<OpsDb>;
}

export const IDEMPOTENCY_ACTOR_RESOLVER = Symbol("IDEMPOTENCY_ACTOR_RESOLVER");
export const IDEMPOTENCY_DB_RESOLVER = Symbol("IDEMPOTENCY_DB_RESOLVER");

interface ReplayPayload {
  readonly __dmIdempotencyReplay: true;
  readonly status: number;
  readonly body: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly actorResolver: IdempotencyActorResolver,
    private readonly dbResolver: IdempotencyDbResolver,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<IdempotencyRouteMeta | undefined>(
      IDEMPOTENCY_META_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<{
      method?: string;
      path?: string;
      url?: string;
      body?: unknown;
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const response = http.getResponse<{
      statusCode?: number;
      status?: (code: number) => void;
    }>();

    const rawKey = request.headers?.["idempotency-key"];
    const keyHeader = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (typeof keyHeader !== "string" || !isIdempotencyKey(keyHeader)) {
      return throwError(
        () =>
          new BadRequestException({
            code: "validation_failed",
            detail: "Idempotency-Key header is required (1–128 visible ASCII).",
          }),
      );
    }

    const key = assertIdempotencyKey(keyHeader);
    const method = (request.method ?? "POST").toUpperCase();
    const path = request.path ?? request.url?.split("?")[0] ?? "/";
    const requestHash = hashCanonicalRequest({
      method,
      path,
      body: request.body ?? null,
    });
    const actorUserId = this.actorResolver.resolveActorUserId(context);
    const claimId = createUuidV7();

    return from(
      (async () => {
        const db = await this.dbResolver.getDb(context);
        return claimIdempotencyKey(db, {
          id: claimId,
          scope: meta.scope,
          actorUserId,
          key,
          requestHash,
          retention: meta.retention,
        }).then((outcome) => ({ db, outcome }));
      })(),
    ).pipe(
      mergeMap(({ db, outcome }) => {
        if (outcome.kind === "conflict") {
          return throwError(
            () =>
              new ConflictException({
                code: "idempotency_conflict",
                detail: "Idempotency-Key was reused with a different canonical request hash.",
              }),
          );
        }
        if (outcome.kind === "in_progress") {
          return throwError(
            () =>
              new ConflictException({
                code: "conflict",
                detail: "A request with this Idempotency-Key is still processing.",
              }),
          );
        }
        if (outcome.kind === "replay") {
          if (typeof response.status === "function") {
            response.status(outcome.responseStatus);
          }
          return of({
            __dmIdempotencyReplay: true,
            status: outcome.responseStatus,
            body: outcome.responseBody,
          } satisfies ReplayPayload);
        }

        const idempotencyId = outcome.id;
        return next.handle().pipe(
          mergeMap((body) =>
            from(
              completeIdempotencyKey(db, {
                id: idempotencyId,
                responseStatus: response.statusCode ?? 201,
                responseBody: body,
                resourceType:
                  isRecord(body) && typeof body["resourceType"] === "string"
                    ? body["resourceType"]
                    : null,
                resourceId: isRecord(body) && typeof body["id"] === "string" ? body["id"] : null,
              }).then(() => body),
            ),
          ),
          catchError((error: unknown) =>
            from(
              failIdempotencyKey(db, idempotencyId, 500, {
                code: "internal_error",
              }).then(() => {
                throw error;
              }),
            ),
          ),
          tap({
            // no-op: completion already persisted
          }),
        );
      }),
      mergeMap((value) => {
        if (isRecord(value) && value["__dmIdempotencyReplay"] === true && "body" in value) {
          return of((value as unknown as ReplayPayload).body);
        }
        return of(value);
      }),
    );
  }
}
