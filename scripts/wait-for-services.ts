import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { Redis } from "ioredis";
import pg from "pg";

import { loadLocalEnv, type LocalEnv } from "./lib/env.ts";

const POLL_INTERVAL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 60_000;

async function poll(
  serviceName: string,
  attempt: () => Promise<void>,
  failureHint: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      await attempt();
      console.log(`[wait-for-services] ${serviceName} is ready.`);
      return;
    } catch (error) {
      lastError = error;
      await sleep(POLL_INTERVAL_MS);
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `${serviceName} did not become ready within ${String(timeoutMs)}ms.\n` +
      `  Last error: ${reason}\n` +
      `  ${failureHint}`,
  );
}

export async function waitForPostgres(
  env: LocalEnv,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const { host, port } = env.postgres;
  await poll(
    `PostgreSQL (${host}:${String(port)})`,
    async () => {
      const client = new pg.Client({ ...env.postgres, connectionTimeoutMillis: 2_000 });
      try {
        await client.connect();
        await client.query("SELECT 1");
      } finally {
        await client.end().catch(() => undefined);
      }
    },
    "Hint: run `pnpm dev:services`, then check `docker logs deutsch-mate-postgres`.",
    timeoutMs,
  );
}

export async function waitForRedis(
  env: LocalEnv,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  await poll(
    `Redis (${env.redisUrl})`,
    async () => {
      const redis = new Redis(env.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
        connectTimeout: 2_000,
      });
      try {
        await redis.connect();
        await redis.ping();
      } finally {
        redis.disconnect();
      }
    },
    "Hint: run `pnpm dev:services`, then check `docker logs deutsch-mate-redis`.",
    timeoutMs,
  );
}

export async function waitForServices(
  env: LocalEnv = loadLocalEnv(),
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  await Promise.all([waitForPostgres(env, timeoutMs), waitForRedis(env, timeoutMs)]);
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  waitForServices().catch((error: unknown) => {
    console.error(`[wait-for-services] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
