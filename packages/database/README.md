# @deutsch-mate/database

Persistence adapter for PostgreSQL 16 using Kysely over `node-postgres`
(ADR-009; `docs/Database.md`; `docs/CODING_STANDARDS.md` §10).

## Scope

- Pool helpers, migration runner, timeout helpers, transaction app-context adapter.
- Ops primitives (DM-023): idempotency claim/complete, transactional outbox insert/claim, inbox consumer, audit append/export.
- No domain logic, no runtime DDL API, no ORM schema auto-sync.
- Kysely types (DM-021+) are persistence adapters only — not API/domain contracts.

## Migrations

Forward-only SQL files live in the repository-root `migrations/` directory and
must match `^\d{4}_[a-z0-9_]+\.sql$`. The runner records SHA-256 of exact file
bytes in `ops.schema_migrations` and refuses to apply if a previously applied
file’s checksum changed.

Each migration runs in a transaction with `SET LOCAL lock_timeout` (default 5s)
and `SET LOCAL statement_timeout` (default 60s). After `0001_extensions_roles.sql`
creates `dm_migrator`, later migrations execute under `SET LOCAL ROLE dm_migrator`.

## Transaction context

API repositories start each transaction with `setTransactionAppContext` /
`withTransactionAppContext`, which SET LOCAL `app.user_id`, `app.roles`, and
`app.correlation_id` from verified OIDC + role lookup (never request fields).

## Local role LOGIN passwords

SQL creates all `dm_*` roles as `NOLOGIN` (no passwords in SQL). After migrate,
non-production runs may grant `LOGIN` + password to runtime roles from env:

- `DATABASE_ROLE_PASSWORD` if set, otherwise `POSTGRES_PASSWORD`
- Never applied when `NODE_ENV=production` or `DM_ENV=production|prod`
- `dm_migrator` stays `NOLOGIN` (used only via `SET ROLE`)

## Commands

```sh
pnpm db:create-empty   # drop/recreate empty database (no extensions)
pnpm db:migrate        # apply pending migrations + local role logins
pnpm db:migrations:verify
pnpm db:reset          # create-empty then migrate (DX default)
pnpm db:rls            # assert FORCE RLS + sample policies + grant boundaries
pnpm test:authorization
```
