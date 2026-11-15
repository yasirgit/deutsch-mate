# `@deutsch-mate/api-client`

Typed Product API client for web and mobile (`dm.tier: shared`, `clientSafe: true`).

- Factory wraps pinned `openapi-fetch` with path types from
  `@deutsch-mate/api-schemas` (generated from `docs/openapi.yaml`).
- Tutor SSE helpers preserve the normative event names and framing from
  `docs/API.md` for `streamTutorRunEvents`.

Never hand-edit generated schema types. Regenerate with `pnpm openapi:generate`.

## Package mapping (DM-025)

| Package                     | Role                                            |
| --------------------------- | ----------------------------------------------- |
| `@deutsch-mate/api-schemas` | Generated OpenAPI types + primitive validators  |
| `@deutsch-mate/api-client`  | This package — fetch client + SSE helpers       |
| `@deutsch-mate/contracts`   | Thin re-export facade for bootstrap-era imports |
