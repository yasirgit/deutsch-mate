import { ConfigValidationError } from "./errors.js";
import { loadEnvAll, type LoadEnvOptions } from "./parse.js";
import {
  AwsWorkloadEnvSchema,
  BaseProcessEnvSchema,
  LocalConnectionEnvSchema,
  PRODUCTION_PROHIBITED_INLINE_SECRET_KEYS,
  ProductionSecretRefsEnvSchema,
  type AwsWorkloadEnv,
  type BaseProcessEnv,
  type LocalConnectionEnv,
  type ProductionSecretRefsEnv,
} from "./schemas.js";

export type SecretSource =
  | {
      readonly mode: "inline";
      readonly connections: LocalConnectionEnv;
    }
  | {
      readonly mode: "workload-identity";
      readonly aws: AwsWorkloadEnv;
      readonly secretRefs: ProductionSecretRefsEnv;
    };

export type ServerRuntimeEnv = BaseProcessEnv & {
  readonly secrets: SecretSource;
};

function assertAbsentKeys(env: NodeJS.ProcessEnv, keys: readonly string[]): void {
  const present = keys.filter((key) => {
    const value = env[key];
    return value !== undefined && value !== "";
  });
  if (present.length > 0) {
    present.sort();
    throw new ConfigValidationError(
      `Inline secret environment variable(s) are forbidden when NODE_ENV=production ` +
        `(use Secrets Manager refs + workload identity): ${present.join(", ")}`,
      present.map((key) => `prohibited inline secret: ${key}`),
    );
  }
}

/**
 * Loads validated configuration for Product API and worker processes.
 *
 * - Always requires `NODE_ENV`, `DM_SERVICE`, and optional `LOG_LEVEL`.
 * - Production: requires AWS region + Secrets Manager IDs; rejects inline
 *   credential/URL env vars (workload identity only).
 * - Development/test: requires `DATABASE_URL` and `REDIS_URL`.
 *
 * Unknown managed keys fail startup.
 */
export function loadServerRuntimeEnv(options: LoadEnvOptions = {}): ServerRuntimeEnv {
  const env = options.env ?? process.env;
  const nodeEnv = env["NODE_ENV"];

  if (nodeEnv === "production") {
    assertAbsentKeys(env, PRODUCTION_PROHIBITED_INLINE_SECRET_KEYS);
    const [base, aws, secretRefs] = loadEnvAll(
      [BaseProcessEnvSchema, AwsWorkloadEnvSchema, ProductionSecretRefsEnvSchema],
      { ...options, env },
    ) as [BaseProcessEnv, AwsWorkloadEnv, ProductionSecretRefsEnv];

    return {
      ...base,
      secrets: {
        mode: "workload-identity",
        aws,
        secretRefs,
      },
    };
  }

  const [base, connections] = loadEnvAll([BaseProcessEnvSchema, LocalConnectionEnvSchema], {
    ...options,
    env,
  }) as [BaseProcessEnv, LocalConnectionEnv];

  return {
    ...base,
    secrets: {
      mode: "inline",
      connections,
    },
  };
}
