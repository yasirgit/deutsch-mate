# `@deutsch-mate/content-pipeline`

Release inventory validation, asset checksum checks, deterministic manifests,
and PostgreSQL draft import for approved curriculum source
(`docs/Database.md` §7; MVP G1; DM-030).

## Connection model

Staff import uses the **deployment/owner** Postgres connection (`DATABASE_URL`).
Locally that is the Compose `deutsch_mate` superuser, which bypasses FORCE RLS.
Production imports should use an audited owner/service session — not learner
`dm_api` without staff claims. Rows are inserted as `status = draft`; publish
is DM-031.

## Root commands

```sh
pnpm content:validate -- --dir content/fixtures/import-smoke
pnpm content:manifest -- --dir content/fixtures/import-smoke
pnpm content:test-import
```
