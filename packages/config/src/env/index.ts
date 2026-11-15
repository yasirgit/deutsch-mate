/**
 * Strict runtime environment schemas and loaders for Product API and workers
 * (DM-012; docs/CODING_STANDARDS.md §4, §13; NFR-005).
 *
 * Tooling exports (`./eslint`, `./prettier`, …) remain separate subpaths.
 */

export { ConfigValidationError } from "./errors.js";
export {
  assertNoUnknownManagedKeys,
  loadEnv,
  loadEnvAll,
  MANAGED_ENV_PREFIXES,
  type LoadEnvOptions,
} from "./parse.js";
export {
  AwsWorkloadEnvSchema,
  BaseProcessEnvSchema,
  LocalConnectionEnvSchema,
  OidcEnvSchema,
  PRODUCTION_PROHIBITED_INLINE_SECRET_KEYS,
  ProductionSecretRefsEnvSchema,
  type AwsWorkloadEnv,
  type BaseProcessEnv,
  type LocalConnectionEnv,
  type OidcEnv,
  type ProductionSecretRefsEnv,
} from "./schemas.js";
export { loadServerRuntimeEnv, type SecretSource, type ServerRuntimeEnv } from "./secrets.js";
