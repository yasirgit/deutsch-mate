import { Module, type DynamicModule, type Provider } from "@nestjs/common";
import { APP_INTERCEPTOR, Reflector } from "@nestjs/core";

import {
  IDEMPOTENCY_ACTOR_RESOLVER,
  IDEMPOTENCY_DB_RESOLVER,
  IdempotencyInterceptor,
  type IdempotencyActorResolver,
  type IdempotencyDbResolver,
} from "./idempotency.interceptor.js";

export interface IdempotencyModuleOptions {
  readonly actorResolver: IdempotencyActorResolver;
  readonly dbResolver: IdempotencyDbResolver;
}

/**
 * Registers the Idempotency-Key interceptor. Callers supply actor + DB resolvers
 * once auth and transactional request context exist (DM-026).
 */
@Module({})
export class IdempotencyModule {
  static register(options: IdempotencyModuleOptions): DynamicModule {
    const actorProvider: Provider = {
      provide: IDEMPOTENCY_ACTOR_RESOLVER,
      useValue: options.actorResolver,
    };
    const dbProvider: Provider = {
      provide: IDEMPOTENCY_DB_RESOLVER,
      useValue: options.dbResolver,
    };
    const interceptorProvider: Provider = {
      provide: APP_INTERCEPTOR,
      useFactory: (
        reflector: Reflector,
        actorResolver: IdempotencyActorResolver,
        dbResolver: IdempotencyDbResolver,
      ) => new IdempotencyInterceptor(reflector, actorResolver, dbResolver),
      inject: [Reflector, IDEMPOTENCY_ACTOR_RESOLVER, IDEMPOTENCY_DB_RESOLVER],
    };

    return {
      module: IdempotencyModule,
      providers: [actorProvider, dbProvider, interceptorProvider],
      exports: [IDEMPOTENCY_ACTOR_RESOLVER, IDEMPOTENCY_DB_RESOLVER],
    };
  }
}

export {
  IDEMPOTENCY_ACTOR_RESOLVER,
  IDEMPOTENCY_DB_RESOLVER,
  IDEMPOTENCY_META_KEY,
  IdempotencyInterceptor,
  RequireIdempotency,
  type IdempotencyActorResolver,
  type IdempotencyDbResolver,
  type IdempotencyRouteMeta,
} from "./idempotency.interceptor.js";
