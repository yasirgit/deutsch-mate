import pg from "pg";

/**
 * Pool construction options. Pass-through of node-postgres `PoolConfig` with
 * a required connection string or discrete host fields supplied by the caller.
 */
export type PgPoolConfig = pg.PoolConfig;

/**
 * Creates a `pg.Pool` for application and worker runtimes. Callers own
 * lifecycle (`pool.end()`). Does not run migrations or DDL.
 */
export function createPgPool(config: PgPoolConfig): pg.Pool {
  return new pg.Pool(config);
}
