import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the repository root (this file lives in scripts/lib/). */
export const repoRoot: string = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export interface PostgresConnection {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

export interface LocalEnv {
  readonly postgres: PostgresConnection;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly apiPort: number;
}

/**
 * Defaults mirror `.env.example` and the fallbacks in `compose.yaml`. The
 * password is a local-only placeholder, not a secret.
 */
const DEFAULTS = {
  POSTGRES_PORT: "54329",
  POSTGRES_USER: "deutsch_mate",
  POSTGRES_PASSWORD: "local-dev-only-not-a-secret",
  POSTGRES_DB: "deutsch_mate_dev",
  REDIS_PORT: "63799",
  API_PORT: "3001",
} as const;

function parseDotEnv(contents: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries.set(key, value);
  }
  return entries;
}

function parsePort(name: string, value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a TCP port number, got "${value}".`);
  }
  return port;
}

/**
 * Resolves local configuration with the same precedence Docker Compose uses:
 * process environment, then the repository-root `.env` file, then the
 * `.env.example`-aligned defaults above.
 */
export function loadLocalEnv(): LocalEnv {
  const dotEnvPath = path.join(repoRoot, ".env");
  const dotEnv = existsSync(dotEnvPath)
    ? parseDotEnv(readFileSync(dotEnvPath, "utf8"))
    : new Map<string, string>();

  const resolve = (key: keyof typeof DEFAULTS | "DATABASE_URL" | "REDIS_URL"): string | null => {
    const fromProcess = process.env[key];
    if (fromProcess !== undefined && fromProcess !== "") {
      return fromProcess;
    }
    const fromFile = dotEnv.get(key);
    if (fromFile !== undefined && fromFile !== "") {
      return fromFile;
    }
    return key in DEFAULTS ? DEFAULTS[key as keyof typeof DEFAULTS] : null;
  };

  const postgresPort = parsePort("POSTGRES_PORT", resolve("POSTGRES_PORT") ?? "");
  const postgresUser = resolve("POSTGRES_USER") ?? "";
  const postgresPassword = resolve("POSTGRES_PASSWORD") ?? "";
  const postgresDb = resolve("POSTGRES_DB") ?? "";

  const databaseUrl =
    resolve("DATABASE_URL") ??
    `postgresql://${encodeURIComponent(postgresUser)}:${encodeURIComponent(postgresPassword)}@localhost:${postgresPort}/${postgresDb}`;

  const redisUrl =
    resolve("REDIS_URL") ??
    `redis://localhost:${parsePort("REDIS_PORT", resolve("REDIS_PORT") ?? "")}`;

  const parsed = new URL(databaseUrl);
  const postgres: PostgresConnection = {
    host: parsed.hostname,
    port: parsed.port === "" ? 5432 : parsePort("DATABASE_URL port", parsed.port),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
  };

  return {
    postgres,
    databaseUrl,
    redisUrl,
    apiPort: parsePort("API_PORT", resolve("API_PORT") ?? ""),
  };
}
