import { describe, expect, it } from "vitest";

import { ConfigValidationError } from "./errors.js";
import { loadEnv } from "./parse.js";
import { BaseProcessEnvSchema, LocalConnectionEnvSchema, OidcEnvSchema } from "./schemas.js";
import { loadServerRuntimeEnv } from "./secrets.js";

describe("loadEnv", () => {
  it("parses a valid strict schema", () => {
    const env = {
      NODE_ENV: "development",
      DM_SERVICE: "api",
      LOG_LEVEL: "debug",
      PATH: "/usr/bin",
    };
    expect(loadEnv(BaseProcessEnvSchema, { env })).toEqual({
      NODE_ENV: "development",
      DM_SERVICE: "api",
      LOG_LEVEL: "debug",
    });
  });

  it("defaults LOG_LEVEL to info", () => {
    const env = {
      NODE_ENV: "test",
      DM_SERVICE: "ai-worker",
    };
    expect(loadEnv(BaseProcessEnvSchema, { env }).LOG_LEVEL).toBe("info");
  });

  it("fails on missing required variables", () => {
    expect(() => loadEnv(BaseProcessEnvSchema, { env: { NODE_ENV: "test" } })).toThrow(
      ConfigValidationError,
    );
  });

  it("fails on unknown managed keys", () => {
    const env = {
      NODE_ENV: "development",
      DM_SERVICE: "api",
      DM_UNEXPECTED: "boom",
    };
    expect(() => loadEnv(BaseProcessEnvSchema, { env })).toThrow(/DM_UNEXPECTED/);
  });

  it("fails on undeclared keys present in a strict schema object", () => {
    const env = {
      DATABASE_URL: "postgresql://localhost/db",
      REDIS_URL: "redis://localhost",
      DATABASE_EXTRA: "nope",
    };
    expect(() => loadEnv(LocalConnectionEnvSchema, { env })).toThrow(/DATABASE_EXTRA/);
  });

  it("parses OIDC issuer/audience config", () => {
    const env = {
      OIDC_ISSUER: "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_x",
      OIDC_AUDIENCE: "app-client-id",
    };
    expect(loadEnv(OidcEnvSchema, { env })).toEqual(env);
  });

  it("rejects unknown OIDC_ managed keys", () => {
    expect(() =>
      loadEnv(OidcEnvSchema, {
        env: {
          OIDC_ISSUER: "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_x",
          OIDC_AUDIENCE: "app-client-id",
          OIDC_SECRET: "nope",
        },
      }),
    ).toThrow(/OIDC_SECRET/);
  });
});

describe("loadServerRuntimeEnv", () => {
  it("loads inline connections outside production", () => {
    const config = loadServerRuntimeEnv({
      env: {
        NODE_ENV: "development",
        DM_SERVICE: "api",
        DATABASE_URL: "postgresql://deutsch_mate:x@localhost:54329/deutsch_mate_dev",
        REDIS_URL: "redis://localhost:63799",
      },
    });
    expect(config.secrets.mode).toBe("inline");
    if (config.secrets.mode === "inline") {
      expect(config.secrets.connections.DATABASE_URL).toContain("postgresql://");
    }
  });

  it("requires Secrets Manager refs and AWS region in production", () => {
    const config = loadServerRuntimeEnv({
      env: {
        NODE_ENV: "production",
        DM_SERVICE: "billing-worker",
        AWS_REGION: "eu-central-1",
        DATABASE_SECRET_ID: "dm/prod/database",
        REDIS_SECRET_ID: "dm/prod/redis",
      },
    });
    expect(config.secrets.mode).toBe("workload-identity");
    if (config.secrets.mode === "workload-identity") {
      expect(config.secrets.aws.AWS_REGION).toBe("eu-central-1");
      expect(config.secrets.secretRefs.DATABASE_SECRET_ID).toBe("dm/prod/database");
    }
  });

  it("rejects inline DATABASE_URL in production", () => {
    expect(() =>
      loadServerRuntimeEnv({
        env: {
          NODE_ENV: "production",
          DM_SERVICE: "api",
          AWS_REGION: "eu-central-1",
          DATABASE_SECRET_ID: "dm/prod/database",
          REDIS_SECRET_ID: "dm/prod/redis",
          DATABASE_URL: "postgresql://should-not-be-here",
        },
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it("rejects static AWS access keys in production", () => {
    expect(() =>
      loadServerRuntimeEnv({
        env: {
          NODE_ENV: "production",
          DM_SERVICE: "api",
          AWS_REGION: "eu-central-1",
          DATABASE_SECRET_ID: "dm/prod/database",
          REDIS_SECRET_ID: "dm/prod/redis",
          AWS_ACCESS_KEY_ID: "AKIA...",
          AWS_SECRET_ACCESS_KEY: "secret",
        },
      }),
    ).toThrow(/workload identity/);
  });

  it("fails when production secret refs are missing", () => {
    expect(() =>
      loadServerRuntimeEnv({
        env: {
          NODE_ENV: "production",
          DM_SERVICE: "api",
          AWS_REGION: "eu-central-1",
        },
      }),
    ).toThrow(ConfigValidationError);
  });
});
