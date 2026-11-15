/**
 * Outbox relay worker (DM-023; ADR-012).
 *
 * Local/dev: Postgres claim + LocalRecordingPublisher.
 * Production: same claim loop; EventBridge publisher arrives with DM-007.
 */

import {
  createKysely,
  createPgPool,
} from "@deutsch-mate/database";
import { sql } from "kysely";

import { runOutboxPollCycle } from "./poller.js";
import {
  LocalRecordingPublisher,
  UnconfiguredEventBridgePublisher,
  type EventPublisher,
} from "./publisher.js";

const WORKER_NAME = "@deutsch-mate/outbox-worker";
const POLL_INTERVAL_MS = Number(process.env["OUTBOX_POLL_INTERVAL_MS"] ?? 2_000);

function logEvent(message: string, fields: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: WORKER_NAME,
      message,
      ...fields,
    }),
  );
}

function waitForShutdownSignal(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    process.once("SIGTERM", () => resolve("SIGTERM"));
    process.once("SIGINT", () => resolve("SIGINT"));
  });
}

function createPublisher(): EventPublisher {
  const mode = process.env["OUTBOX_TRANSPORT"] ?? "local-memory";
  switch (mode) {
    case "local-memory":
      return new LocalRecordingPublisher();
    case "eventbridge":
      return new UnconfiguredEventBridgePublisher();
    default:
      throw new Error(
        `Unknown OUTBOX_TRANSPORT="${mode}". Use local-memory or eventbridge.`,
      );
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for outbox-worker.");
  }

  const pool = createPgPool({ connectionString: databaseUrl });
  const db = createKysely({ pool });
  const publisher = createPublisher();
  let stopping = false;

  logEvent("worker started", {
    transport: process.env["OUTBOX_TRANSPORT"] ?? "local-memory",
  });

  const pollLoop = (async () => {
    while (!stopping) {
      try {
        const result = await db.transaction().execute(async (trx) => {
          await sql`SET LOCAL ROLE dm_outbox_worker`.execute(trx);
          return runOutboxPollCycle(trx, publisher);
        });
        if (result.claimed > 0) {
          logEvent("outbox poll cycle", { ...result });
        }
      } catch (error) {
        logEvent("outbox poll error", {
          code: "outbox_poll_failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  })();

  const signal = await waitForShutdownSignal();
  stopping = true;
  logEvent(`received ${signal}; shutting down gracefully`);
  await pollLoop;
  await db.destroy();
  logEvent("worker stopped");
}

void main().catch((error: unknown) => {
  logEvent("worker crashed", {
    detail: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
