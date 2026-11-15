# `@deutsch-mate/contracts`

Thin re-export facade over the DM-025 OpenAPI packages:

| Package                     | Role                                                            |
| --------------------------- | --------------------------------------------------------------- |
| `@deutsch-mate/api-schemas` | Generated types from `docs/openapi.yaml` + primitive validators |
| `@deutsch-mate/api-client`  | Typed `openapi-fetch` client + tutor SSE helpers                |
| `@deutsch-mate/contracts`   | This package — re-exports both for bootstrap-era imports        |

Prefer `@deutsch-mate/api-client` / `@deutsch-mate/api-schemas` in new code.
Never hand-edit generated artifacts; run `pnpm openapi:generate`.
