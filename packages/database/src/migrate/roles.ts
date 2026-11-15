import pg from "pg";

/** NOLOGIN migrator role; sessions use `SET ROLE` (docs/Database.md §8). */
export const MIGRATOR_ROLE = "dm_migrator";

/**
 * Runtime roles that may receive LOGIN + password in non-production local
 * migrate only. Passwords never appear in SQL.
 */
export const RUNTIME_LOGIN_ROLES = [
  "dm_api",
  "dm_ai_worker",
  "dm_billing_worker",
  "dm_media_worker",
  "dm_privacy_worker",
  "dm_outbox_worker",
  "dm_read_replica",
] as const;

const SAFE_ROLE = /^[a-z][a-z0-9_]*$/;

function isProductionEnvironment(): boolean {
  const nodeEnv = process.env["NODE_ENV"];
  const dmEnv = process.env["DM_ENV"];
  return nodeEnv === "production" || dmEnv === "production" || dmEnv === "prod";
}

/**
 * Grants LOGIN with a password to runtime roles for local development.
 * No-op in production. Does not alter `dm_migrator` (stays NOLOGIN).
 */
export async function enableLocalRoleLogins(
  client: pg.PoolClient | pg.Client,
  password: string,
): Promise<void> {
  if (isProductionEnvironment()) {
    return;
  }
  if (password === "") {
    throw new Error("Refusing to set empty DATABASE_ROLE_PASSWORD / POSTGRES_PASSWORD.");
  }
  for (const role of RUNTIME_LOGIN_ROLES) {
    if (!SAFE_ROLE.test(role)) {
      throw new Error(`Refusing unsafe role name "${role}".`);
    }
    await client.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD ${pg.escapeLiteral(password)}`);
  }
}
