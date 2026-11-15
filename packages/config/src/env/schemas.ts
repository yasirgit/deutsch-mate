import { z } from "zod";

/**
 * Process identity shared by Product API and workers.
 * `.strict()` rejects undeclared keys on the parsed object.
 */
export const BaseProcessEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    DM_SERVICE: z.enum([
      "api",
      "ai-worker",
      "billing-worker",
      "privacy-worker",
      "outbox-worker",
      "media-worker",
    ]),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .strict();

export type BaseProcessEnv = z.infer<typeof BaseProcessEnvSchema>;

/**
 * AWS region for workload-identity credential resolution (ECS task role /
 * IRSA). Static long-lived access keys are forbidden in production schemas.
 */
export const AwsWorkloadEnvSchema = z
  .object({
    AWS_REGION: z.string().min(1),
    AWS_ROLE_ARN: z.string().min(1).optional(),
  })
  .strict();

export type AwsWorkloadEnv = z.infer<typeof AwsWorkloadEnvSchema>;

/**
 * Secrets Manager identifiers (name or ARN). Values are resolved at runtime
 * through the workload IAM role — never shipped as plaintext env vars in
 * production (NFR-005; ADR-017).
 */
export const ProductionSecretRefsEnvSchema = z
  .object({
    DATABASE_SECRET_ID: z.string().min(1),
    REDIS_SECRET_ID: z.string().min(1),
  })
  .strict();

export type ProductionSecretRefsEnv = z.infer<typeof ProductionSecretRefsEnvSchema>;

/**
 * Inline connection URLs for local development and automated tests only.
 */
export const LocalConnectionEnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
  })
  .strict();

export type LocalConnectionEnv = z.infer<typeof LocalConnectionEnvSchema>;

/**
 * Environment variable names that must never appear in production process
 * configuration. Secrets are fetched via workload identity + Secrets Manager
 * refs instead.
 */
export const PRODUCTION_PROHIBITED_INLINE_SECRET_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "OPENAI_API_KEY",
] as const;

/**
 * Cognito/OIDC verifier configuration for the Product API (DM-035).
 * Issuer and audience are config, not secrets. Optional JWKS URI defaults to
 * `{OIDC_ISSUER}/.well-known/jwks.json` at runtime.
 */
export const OidcEnvSchema = z
  .object({
    OIDC_ISSUER: z.string().url(),
    OIDC_AUDIENCE: z.string().min(1),
    OIDC_JWKS_URI: z.string().url().optional(),
  })
  .strict();

export type OidcEnv = z.infer<typeof OidcEnvSchema>;
