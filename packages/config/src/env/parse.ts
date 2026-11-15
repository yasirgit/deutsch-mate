import { z } from "zod";

import { ConfigValidationError } from "./errors.js";

/**
 * Prefixes that belong to Deutsch Mate process configuration. An undeclared
 * key under these prefixes fails startup (strict unknown-key policy).
 * OS/runtime keys such as `PATH` are ignored.
 */
export const MANAGED_ENV_PREFIXES: readonly string[] = [
  "DM_",
  "DATABASE_",
  "REDIS_",
  "LOG_",
  "AWS_",
  "STRIPE_",
  "OPENAI_",
  "OIDC_",
  "NODE_ENV",
] as const;

export interface LoadEnvOptions {
  /** Source map; defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Additional managed-key prefixes to reject when undeclared. Defaults to
   * {@link MANAGED_ENV_PREFIXES}.
   */
  readonly managedPrefixes?: readonly string[];
}

function isManagedKey(key: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) =>
    prefix.endsWith("_") ? key.startsWith(prefix) : key === prefix || key.startsWith(`${prefix}_`),
  );
}

function schemaKeys(schema: z.ZodObject<z.ZodRawShape>): readonly string[] {
  return Object.keys(schema.shape);
}

/**
 * Fails when any managed environment key is present but not declared on the
 * schema. Used so typos and surprise secrets cannot slip past validation.
 */
export function assertNoUnknownManagedKeys(
  env: NodeJS.ProcessEnv,
  knownKeys: ReadonlySet<string>,
  managedPrefixes: readonly string[] = MANAGED_ENV_PREFIXES,
): void {
  const unknown: string[] = [];
  for (const key of Object.keys(env)) {
    if (!isManagedKey(key, managedPrefixes)) {
      continue;
    }
    if (!knownKeys.has(key)) {
      unknown.push(key);
    }
  }
  if (unknown.length > 0) {
    unknown.sort();
    throw new ConfigValidationError(
      `Unknown managed environment variable(s): ${unknown.join(", ")}`,
      unknown.map((key) => `unknown key: ${key}`),
    );
  }
}

/**
 * Picks schema-declared keys from `env` and validates them with a strict
 * Zod object schema. Missing required values and unknown managed keys fail
 * fast with {@link ConfigValidationError}.
 */
export function loadEnv<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
  options: LoadEnvOptions = {},
): z.infer<T> {
  const env = options.env ?? process.env;
  const managedPrefixes = options.managedPrefixes ?? MANAGED_ENV_PREFIXES;
  const keys = schemaKeys(schema);
  assertNoUnknownManagedKeys(env, new Set(keys), managedPrefixes);

  const picked: Record<string, string | undefined> = {};
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined) {
      picked[key] = value;
    }
  }

  const result = schema.safeParse(picked);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    });
    throw new ConfigValidationError(
      `Invalid environment configuration: ${issues.join("; ")}`,
      issues,
    );
  }
  return result.data;
}

/**
 * Merges several strict object schemas' keys into one allowlist check, then
 * parses each schema against the same env. Useful when a process composes
 * base + service-specific configuration.
 */
export function loadEnvAll(
  schemas: readonly z.ZodObject<z.ZodRawShape>[],
  options: LoadEnvOptions = {},
): readonly unknown[] {
  const env = options.env ?? process.env;
  const managedPrefixes = options.managedPrefixes ?? MANAGED_ENV_PREFIXES;
  const known = new Set<string>();
  for (const schema of schemas) {
    for (const key of schemaKeys(schema)) {
      known.add(key);
    }
  }
  assertNoUnknownManagedKeys(env, known, managedPrefixes);

  return schemas.map((schema) => {
    const keys = schemaKeys(schema);
    const picked: Record<string, string | undefined> = {};
    for (const key of keys) {
      const value = env[key];
      if (value !== undefined) {
        picked[key] = value;
      }
    }
    const result = schema.safeParse(picked);
    if (!result.success) {
      const issues = result.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `${path}: ${issue.message}`;
      });
      throw new ConfigValidationError(
        `Invalid environment configuration: ${issues.join("; ")}`,
        issues,
      );
    }
    return result.data;
  });
}
