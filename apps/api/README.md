# @deutsch-mate/api

NestJS modular-monolith Product API (ADR-006). Global prefix `/v1`. Platform
cross-cutting behavior lives under `src/platform/` (DM-026).

**Module system:** this app compiles to CommonJS (no `"type": "module"`).
NestJS 11 ships CJS and relies on `experimentalDecorators`/
`emitDecoratorMetadata`; `verbatimModuleSyntax` is disabled in this app's
tsconfig because that flag forbids standard ESM import syntax in CJS files.
Workers and packages are ESM. Built with plain `tsc` (no webpack).

## Platform behavior (DM-026)

| Concern                                                          | Location                                      |
| ---------------------------------------------------------------- | --------------------------------------------- |
| `X-Request-Id` + ALS request store                               | `platform/request-context.ts`                 |
| Auth (OIDC Bearer + local/test `X-DM-Test-Actor`)                 | `platform/auth/` + `modules/identity/`        |
| RFC 9457 Problem Details filter                                  | `platform/errors/`                            |
| Strict ValidationPipe (unknown fields fail)                      | `platform/validation.pipe.ts`                 |
| ETag / If-Match (`lockVersion`)                                  | `platform/etag.ts`                            |
| Opaque cursor pagination                                         | `platform/cursor.ts`                          |
| Rate-limit header stubs                                          | `platform/rate-limit.interceptor.ts`          |
| Request DB transaction + correlation                             | `platform/request-transaction.interceptor.ts` |
| Idempotency-Key                                                  | `platform/idempotency/` (DM-023)              |
| Health live/ready                                                | `health/`                                     |

Acting user identity is never taken from body, path, or query. Production
authentication verifies Cognito/OIDC Bearer tokens (DM-035) then resolves or
provisions the product user. Local/test may use `X-DM-Test-Actor`
(`NODE_ENV` ≠ `production`). Blocked, deleted, and deletion_pending accounts
receive **403** `account_access_denied` (token ok; product access denied).

Liveness (`GET /v1/health/live`) is process-only. Readiness
(`GET /v1/health/ready`) checks PostgreSQL and returns `503` Problem Details
when unavailable (deploy-safe).

## Scripts

```sh
pnpm --filter @deutsch-mate/api build
pnpm test:contract --filter api-platform
pnpm test:contract --filter identity-profile
pnpm test:contract --filter curriculum
pnpm test:integration --filter api-platform
pnpm test:integration --filter identity
pnpm test:integration --filter curriculum
pnpm test:resilience --filter ai-outage
pnpm test:security --filter oidc --filter account-isolation
```
