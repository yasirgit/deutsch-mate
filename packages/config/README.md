# @deutsch-mate/config

Shared lint/format/boundary policy **and** strict process environment
schemas for Product API and workers (`docs/CODING_STANDARDS.md` §2, §4,
§5, §13, §16; DM-003, DM-012).

## Exports

- `@deutsch-mate/config/env` — Zod environment schemas and fail-fast loaders
  (`loadEnv`, `loadServerRuntimeEnv`). Rejects unknown managed keys and
  missing required variables. Production requires Secrets Manager IDs plus
  AWS region (workload identity); inline `DATABASE_URL` /
  `AWS_ACCESS_KEY_ID` / provider API keys are forbidden.
- `@deutsch-mate/config/eslint` — shared ESLint flat configuration
  (typescript-eslint plus import hygiene). The default export is the tierless
  base config (used by the repository root); workspaces call
  `configForWorkspace(import.meta.url)`, which reads the workspace's own
  `dm.tier` metadata, or `configForTier(tier)` directly.
- `@deutsch-mate/config/prettier` — shared Prettier configuration.
- `@deutsch-mate/config/dependency-cruiser` —
  `createDependencyCruiserConfig(repoRootDir)` builds the dependency-graph
  policy behind `pnpm boundaries:check` (cycles, tier matrix, adapter bans).
- `@deutsch-mate/config/workspace-metadata` — reads `dm.tier` ownership
  metadata from every workspace `package.json` and defines the tier import
  matrix and forbidden package lists shared by both checkers.

## Ownership tiers

Every workspace `package.json` declares `"dm": { "tier": ... }`:

| Tier      | Workspaces                                                                                                                      | May import (workspace tiers)                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `domain`  | `packages/domain`                                                                                                               | `domain` only; no framework/provider/adapter packages     |
| `shared`  | `packages/api-schemas` / `api-client` / `contracts` (`clientSafe`), `packages/observability` / `database` (`clientSafe: false`) | `domain`, `shared`                                        |
| `client`  | `apps/web`, `apps/mobile`                                                                                                       | `shared` with `clientSafe: true`; no server-only packages |
| `server`  | `apps/api`                                                                                                                      | `domain`, `shared`; no client UI frameworks               |
| `worker`  | `apps/*-worker`                                                                                                                 | `domain`, `shared`; no client UI frameworks               |
| `tooling` | `packages/test-kit`, `scripts`                                                                                                  | `domain`, `shared`, `tooling`                             |

Apps (`client`/`server`/`worker`) are leaves: no workspace may import them.
`tooling` workspaces are dev-only and importable from test/tool-config files
only. `@deutsch-mate/config` is `shared` + `clientSafe: false` so API/workers
may import `/env` at runtime; clients may still use `/eslint` and `/prettier`
from eslint/prettier config files (devDependency). Generic `common`/`utils`
dumping-ground packages must not exist. Undeclared (transitive) imports are
errors via `import-x/no-extraneous-dependencies`, and `pnpm deps:check`
(knip) fails on undeclared and unused dependencies.

The shared strict TypeScript compiler baseline lives at the repository root in
`tsconfig.base.json`. Structured redaction and logging live in
`@deutsch-mate/observability`.
