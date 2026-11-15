/**
 * Stub rate-limit response headers (docs/API.md / OpenAPI RateLimit*).
 * Enforcement lands with edge WAF / gateway; header names are contract-stable.
 */

import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";

/** Stub defaults until DM edge rate limiting is wired. */
export const RATE_LIMIT_STUB = {
  limit: 120,
  remaining: 119,
  resetSeconds: 60,
} as const;

@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<{
      setHeader: (name: string, value: string | number) => void;
    }>();

    return next.handle().pipe(
      tap(() => {
        response.setHeader("RateLimit-Limit", RATE_LIMIT_STUB.limit);
        response.setHeader("RateLimit-Remaining", RATE_LIMIT_STUB.remaining);
        response.setHeader("RateLimit-Reset", RATE_LIMIT_STUB.resetSeconds);
      }),
    );
  }
}
