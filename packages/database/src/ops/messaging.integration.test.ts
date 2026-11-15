/**
 * Outbox + inbox messaging integration tests (DM-023; ADR-012).
 */

import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../kysely.js";
import { consumeInboxMessage } from "./inbox.js";
import {
  claimOutboxBatch,
  insertOutboxEvent,
  markOutboxPublished,
  outboxRowToEnvelope,
} from "./outbox.js";
import {
  createMigratedTestDatabase,
  createUuidV7,
  withWorkerRole,
} from "./test-harness.js";

describe("messaging", () => {
  let db: Kysely<Database>;
  let dispose: () => Promise<void>;
  const correlationId = createUuidV7();

  beforeAll(async () => {
    const harness = await createMigratedTestDatabase("deutsch_mate_dm023_messaging");
    db = harness.db;
    dispose = harness.dispose;
  }, 120_000);

  afterAll(async () => {
    await dispose();
  });

  it("inserts outbox in the same transaction as a business mutation", async () => {
    const aggregateId = createUuidV7();
    const eventId = createUuidV7();
    const probeKey = `probe-${createUuidV7()}`;

    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL ROLE dm_api`.execute(trx);
      await insertOutboxEvent(trx, {
        id: eventId,
        aggregateType: "probe",
        aggregateId,
        eventType: "ops.probe.v1",
        eventVersion: 1,
        payload: { probeKey },
        headers: { source: "test" },
        correlationId,
        causationId: null,
      });
    });

    const { rows } = await sql<{ id: string; status: string; correlation_id: string }>`
      SELECT id, status::text AS status, correlation_id::text AS correlation_id
      FROM ops.outbox_events WHERE id = ${eventId}::uuid
    `.execute(db);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.correlation_id).toBe(correlationId);
  });

  it("claims unpublished rows and yields one inbox effect under duplicate delivery", async () => {
    const eventId = createUuidV7();
    const aggregateId = createUuidV7();
    const probeKey = `dup-${createUuidV7()}`;

    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL ROLE dm_api`.execute(trx);
      await insertOutboxEvent(trx, {
        id: eventId,
        aggregateType: "probe",
        aggregateId,
        eventType: "ops.probe.v1",
        eventVersion: 1,
        payload: { probeKey },
        correlationId,
        causationId: correlationId,
      });
    });

    const claimed = await withWorkerRole(db, "dm_outbox_worker", async (trx) => {
      const rows = await claimOutboxBatch(trx, { batchSize: 10, maxAttempts: 8 });
      for (const row of rows) {
        const envelope = outboxRowToEnvelope(row);
        expect(envelope.correlationId).toBeTruthy();
        await markOutboxPublished(trx, row.id);
      }
      return rows;
    });
    expect(claimed.some((row) => row.id === eventId)).toBe(true);

    let effectCount = 0;
    const applyEffect = async () => {
      effectCount += 1;
      return { probeKey, applied: true };
    };

    const first = await withWorkerRole(db, "dm_ai_worker", async (trx) =>
      consumeInboxMessage(trx, {
        inboxId: createUuidV7(),
        consumerName: "probe-consumer",
        messageId: eventId,
        eventType: "ops.probe.v1",
        payload: { probeKey },
        effect: applyEffect,
      }),
    );
    expect(first.kind).toBe("processed");
    expect(effectCount).toBe(1);

    const second = await withWorkerRole(db, "dm_ai_worker", async (trx) =>
      consumeInboxMessage(trx, {
        inboxId: createUuidV7(),
        consumerName: "probe-consumer",
        messageId: eventId,
        eventType: "ops.probe.v1",
        payload: { probeKey },
        effect: applyEffect,
      }),
    );
    expect(second.kind).toBe("duplicate");
    expect(effectCount).toBe(1);
  });
});
