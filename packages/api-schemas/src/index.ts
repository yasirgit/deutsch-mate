/**
 * OpenAPI-derived TypeScript types for the Deutsch Mate Product API.
 *
 * Source of truth: `docs/openapi.yaml` (OpenAPI 3.1).
 * Regenerate with `pnpm openapi:generate`. Never hand-edit `src/generated/`.
 *
 * Package mapping (DM-025):
 * - `@deutsch-mate/api-schemas` — generated path/operation/schema types +
 *   primitive validators (UUIDv7, decimal/bigint strings, RFC 9457 Problem).
 * - `@deutsch-mate/api-client` — typed `openapi-fetch` factory + tutor SSE helpers.
 * - `@deutsch-mate/contracts` — thin re-export facade for bootstrap-era imports.
 */

export type * from "./generated/openapi.js";

export {
  UUID_V7_PATTERN,
  DECIMAL_PATTERN,
  BIG_INTEGER_PATTERN,
  PROBLEM_REQUIRED_FIELDS,
  isUuidV7,
  isDecimalString,
  isBigIntegerString,
  isProblemDetails,
  type ProblemRequiredField,
} from "./primitives.js";
