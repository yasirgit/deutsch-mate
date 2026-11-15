# `@deutsch-mate/api-schemas`

Generated TypeScript types from `docs/openapi.yaml` (OpenAPI 3.1). This is the
sole schema contract for web and mobile clients (NFR-010, ADR-008).

## Ownership

- `dm.tier: shared`, `clientSafe: true`
- Source of truth: `docs/openapi.yaml`
- Generated output: `src/generated/openapi.ts` — **never hand-edit**

## Commands

```sh
pnpm openapi:lint      # Redocly lint (pinned @redocly/cli)
pnpm openapi:generate  # regenerate this package
pnpm openapi:drift     # fail if generated output differs from HEAD
pnpm openapi:compat    # operationIds, Problem, UuidV7/Decimal/BigInteger, SSE
```

## Related packages

| Package                     | Role                                      |
| --------------------------- | ----------------------------------------- |
| `@deutsch-mate/api-schemas` | Generated types + primitive validators    |
| `@deutsch-mate/api-client`  | Typed fetch client + tutor SSE helpers    |
| `@deutsch-mate/contracts`   | Re-exports both for bootstrap-era imports |
