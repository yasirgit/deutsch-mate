import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Redis } from "ioredis";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadLocalEnv, repoRoot } from "../lib/env.ts";

/**
 * DM-002 smoke test for the canonical local stack. Requires `pnpm
 * dev:services` (healthy compose services) and a built API
 * (`turbo run test:smoke` builds it via the task dependency).
 */
const env = loadLocalEnv();

const SCRATCH_TABLE = "dm002_smoke_durability";

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not determine a free port."));
        return;
      }
      server.close(() => {
        resolve(address.port);
      });
    });
  });
}

describe("PostgreSQL", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ ...env.postgres, connectionTimeoutMillis: 5_000 });
    await client.connect();
  });

  afterAll(async () => {
    await client.query(`DROP TABLE IF EXISTS "${SCRATCH_TABLE}"`);
    await client.end();
  });

  it("answers SELECT 1", async () => {
    const { rows } = await client.query<{ ok: number }>("SELECT 1 AS ok");
    expect(rows[0]?.ok).toBe(1);
  });

  it("has the required extensions (pgcrypto, citext, btree_gist)", async () => {
    // Owned by migrations/0001_extensions_roles.sql (DM-020); requires migrate.
    const { rows } = await client.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = ANY($1) ORDER BY extname",
      [["pgcrypto", "citext", "btree_gist"]],
    );
    expect(rows.map((row) => row.extname)).toEqual(["btree_gist", "citext", "pgcrypto"]);
  });

  it("keeps durable facts through a full Redis flush (disposable-Redis contract)", async () => {
    const marker = `dm-002-smoke-${String(Date.now())}`;
    await client.query(
      `CREATE TABLE IF NOT EXISTS "${SCRATCH_TABLE}" (marker text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`,
    );
    await client.query(`INSERT INTO "${SCRATCH_TABLE}" (marker) VALUES ($1)`, [marker]);

    const redis = new Redis(env.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      await redis.connect();
      await redis.flushall();
    } finally {
      redis.disconnect();
    }

    const { rows } = await client.query<{ marker: string }>(
      `SELECT marker FROM "${SCRATCH_TABLE}" WHERE marker = $1`,
      [marker],
    );
    expect(rows[0]?.marker).toBe(marker);
  });
});

describe("Redis", () => {
  it("answers PING", async () => {
    const redis = new Redis(env.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      connectTimeout: 5_000,
    });
    try {
      await redis.connect();
      await expect(redis.ping()).resolves.toBe("PONG");
    } finally {
      redis.disconnect();
    }
  });
});

describe("API liveness", () => {
  const apiEntry = path.join(repoRoot, "apps", "api", "dist", "main.js");
  let apiProcess: ChildProcess | null = null;
  let apiPort = 0;

  beforeAll(async () => {
    if (!existsSync(apiEntry)) {
      throw new Error(
        `Compiled API not found at ${apiEntry}. Run \`pnpm build --filter @deutsch-mate/api\` first.`,
      );
    }
    apiPort = await findFreePort();
    apiProcess = spawn(process.execPath, [apiEntry], {
      env: { ...process.env, PORT: String(apiPort) },
      stdio: "ignore",
    });
  });

  afterAll(async () => {
    if (apiProcess !== null) {
      apiProcess.kill("SIGTERM");
      await sleep(200);
    }
  });

  it("serves GET /health/live from the compiled API", async () => {
    const deadline = Date.now() + 15_000;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${String(apiPort)}/health/live`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as { status: string; checkedAt: string };
        expect(body.status).toBe("ok");
        expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
        return;
      } catch (error) {
        lastError = error;
        await sleep(250);
      }
    }
    throw new Error(
      `API did not serve /health/live within 15s: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  });
});
