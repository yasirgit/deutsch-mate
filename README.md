# Deutsch Mate

EU-first B2C German-learning product for adult self-learners (CEFR A1-B2).
See `AI_CONTEXT.md` for the operating brief and `docs/` for the authoritative
product, architecture, contract, and backlog documents.

## Repository layout

- `apps/` — Next.js web, React Native mobile (placeholder until DM-058),
  NestJS Product API, and independently scalable workers
  (ai/billing/privacy/outbox/media).
- `packages/` — OpenAPI schemas/client (`api-schemas`, `api-client`,
  `contracts` facade), pure domain, config, observability, database
  (Kysely/pg adapter), and test-kit packages.
- `infra/`, `migrations/`, `scripts/` — IaC, forward-only SQL, and operations
  (populated by later tasks; see each README).

## Toolchain

Node 22 (`.nvmrc`), pnpm via corepack (`packageManager` in `package.json`),
Turborepo. Strict TypeScript everywhere (`tsconfig.base.json`).

## Developer setup

Prerequisites: Node 22 (`.nvmrc`), a running Docker daemon with Compose v2,
and pnpm via corepack.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm bootstrap       # checks pins, creates .env from .env.example, starts services
pnpm db:reset        # recreate empty DB, apply migrations (extensions/roles via 0001)
pnpm test:smoke      # verifies PostgreSQL, Redis, and the compiled API liveness
pnpm dev             # starts services, then app dev tasks via turbo
```

Local PostgreSQL 16 and Redis 7 run from `compose.yaml` on non-default host
ports (54329/63799, override in `.env`). They are disposable; PostgreSQL is
the only durable store. Manage them with `pnpm dev:services` /
`pnpm dev:services:down`. Never commit a real `.env` — `.env.example` holds
the non-secret local placeholders.

Database commands: `pnpm db:create-empty`, `pnpm db:migrate`,
`pnpm db:migrations:verify`, or `pnpm db:reset` (create-empty + migrate).
Local runtime role LOGIN passwords come from `DATABASE_ROLE_PASSWORD` or
`POSTGRES_PASSWORD` during migrate (never from SQL; skipped in production).

## Commands

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm openapi:lint && pnpm openapi:generate && pnpm openapi:drift && pnpm openapi:compat
```

OpenAPI source of truth is `docs/openapi.yaml`. Generated types live in
`packages/api-schemas` (never hand-edit); web/mobile import
`@deutsch-mate/api-client`.
