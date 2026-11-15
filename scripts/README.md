# scripts/

Reproducible repository, database, content, and release operations
(`AI_CONTEXT.md` repository shape). This is the `@deutsch-mate/scripts`
workspace so scripts run through the repository-pinned toolchain and
participate in root `format`/`lint`/`typecheck`/`test` via Turborepo.

Owned by the repository/platform lane. Scripts must be idempotent, pinned to
repository tool versions, and free of secrets.

## Contents

- `bootstrap-local.ts` — idempotent local setup: verifies Node/pnpm pins and
  Docker availability, creates `.env` from `.env.example` if absent, starts
  `compose.yaml` services, waits for health. Root: `pnpm bootstrap`.
- `wait-for-services.ts` — polls PostgreSQL (connect + `SELECT 1`) and Redis
  (`PING`) with a timeout and actionable failure output.
- `db-create-empty.ts` — drops/recreates an empty database (no extensions).
  Root: `pnpm db:create-empty`.
- `migrate.ts` — applies forward-only SQL from `migrations/` via
  `@deutsch-mate/database`, then grants local runtime role LOGIN passwords from
  env (non-production). Root: `pnpm db:migrate`.
- `db-migrations-verify.ts` — checks ledger SHA-256 values match on-disk files.
  Root: `pnpm db:migrations:verify`.
- `db-reset.ts` — `create-empty` then `migrate` (DX default). Root: `pnpm db:reset`.
- `smoke/local-stack.smoke.ts` — `pnpm test:smoke`: PostgreSQL `SELECT 1` +
  extension check, Redis `PING`, durable-facts-survive-Redis-flush check, and
  compiled API `GET /health/live`. Excluded from the default `test` task
  because it requires live local services.
- `content-validate.ts` / `content-manifest.ts` / `content-import.ts` /
  `content-test-import.ts` — curriculum release inventory, deterministic
  manifests, and draft Postgres import (`pnpm content:validate`,
  `content:manifest`, `content:test-import`). Defaults to
  `content/fixtures/import-smoke/`.
