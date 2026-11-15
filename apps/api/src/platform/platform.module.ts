/**
 * NestJS Product API platform cross-cutting module (DM-026).
 *
 * Wires request ID, auth stub, Problem Details, validation support, ETag/
 * cursor helpers (exported), rate-limit header stubs, request transactions,
 * and the existing IdempotencyInterceptor.
 */

import { Global, Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, Reflector } from "@nestjs/core";

import { AuthGuard } from "./auth/auth.guard.js";
import { DatabaseModule } from "./database.module.js";
import { ProblemDetailsFilter } from "./errors/problem-details.filter.js";
import { IdempotencyModule, type IdempotencyActorResolver } from "./idempotency/index.js";
import { RateLimitInterceptor } from "./rate-limit.interceptor.js";
import { getRequestStore } from "./request-context.js";
import {
  createIdempotencyDbResolver,
  RequestTransactionInterceptor,
} from "./request-transaction.interceptor.js";

const actorResolver: IdempotencyActorResolver = {
  resolveActorUserId: () => getRequestStore()?.actor?.userId ?? null,
};

/**
 * Platform cross-cutting providers. Request-ID middleware is applied in
 * `main.ts` / test bootstrap via `app.use(requestIdMiddleware)` so ALS
 * context is established before Nest routing.
 */
@Global()
@Module({})
export class PlatformModule {
  static register(): DynamicModule {
    return {
      module: PlatformModule,
      imports: [
        DatabaseModule.registerOptional(),
        IdempotencyModule.register({
          actorResolver,
          dbResolver: createIdempotencyDbResolver(),
        }),
      ],
      providers: [
        Reflector,
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_GUARD, useClass: AuthGuard },
        // Registration order: later APP_INTERCEPTOR wraps earlier ones (outer).
        // IdempotencyModule registers first (inner); transaction must be outer.
        { provide: APP_INTERCEPTOR, useClass: RateLimitInterceptor },
        {
          provide: APP_INTERCEPTOR,
          useClass: RequestTransactionInterceptor,
        },
      ],
      exports: [DatabaseModule],
    };
  }
}

export { AuthGuard, TEST_ACTOR_HEADER, TEST_ROLES_HEADER } from "./auth/auth.guard.js";
export { Public } from "./auth/public.decorator.js";
export type { RequestActor } from "./auth/actor.js";
export { KYSELY } from "./database.tokens.js";
export type { KyselyToken } from "./database.tokens.js";
export { assertIfMatch, formatLockVersionEtag, parseIfMatchLockVersion } from "./etag.js";
export {
  buildPageResponse,
  decodeCursor,
  encodeCursor,
  parsePageParams,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from "./cursor.js";
export { ProblemDetailsFilter } from "./errors/problem-details.filter.js";
export { buildProblem, PROBLEM_TYPE_BASE } from "./errors/problem.js";
export {
  Transactional,
  SerializableIsolation,
  SERIALIZABLE_MAX_ATTEMPTS,
} from "./request-transaction.interceptor.js";
export { RequireIdempotency, IdempotencyInterceptor } from "./idempotency/index.js";
