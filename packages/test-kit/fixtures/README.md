# Boundary-tooling fixtures

Deliberate boundary violations consumed programmatically by
`src/boundary-tooling.test.ts` (DM-003). They assert that the shared ESLint
tier config and the dependency-cruiser policy keep flagging forbidden
imports, so regressions in the boundary configuration are caught by
`pnpm test`.

These files are excluded from lint (`eslint.config.mjs` ignores), from the
production build (`tsconfig.build.json` includes `src/` only), from
`boundaries:check` (the shared dependency-cruiser options exclude
`fixtures/`), and from `deps:check` (`knip.jsonc` ignores them).
