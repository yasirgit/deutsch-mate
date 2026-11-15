/**
 * Duplicate-delivery resilience: outbox republish + inbox once-only (DM-023).
 */

import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../kysely.js";
import { consumeInboxMessage } from "./inbox.js";
import {
  claimOutboxBatch,
  insertOutboxEvent,
  markOutboxPublished,
  replayOutboxEvent,
} from "./outbox.js";
import {
  createMigratedTestDatabase,
  createUuidV7,
  withWorkerRole,
} from "./test-harness.js";

describe("duplicates", () => {
  let db: Kysely<Database>;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    const harness = await createMigratedTestDatabase("deutsch_mate_dm023_duplicates");
    db = harness.db;
    dispose = harness.dispose;
  }, 120_000);

  afterAll(async () => {
    await dispose();
  });

  it("replays a published outbox event without duplicating inbox effects", async () => {
    const eventId = createUuidV7();
    const correlationId = createUuidV7();
    const aggregateId = createUuidV7();

    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL ROLE dm_api`.execute(trx);
      await insertOutboxEvent(trx, {
        id: eventId,
        aggregateType: "probe",
        aggregateId,
        eventType: "ops.probe.v1",
        eventVersion: 1,
        payload: { probeKey: "resilience" },
        correlationId,
      });
    });

    await withWorkerRole(db, "dm_outbox_worker", async (trx) => {
      const rows = await claimOutboxBatch(trx);
      expect(rows.some((row) => row.id === eventId)).toBe(true);
      await markOutboxPublished(trx, eventId);
    });

    let effectCount = 0;
    const deliver = async () =>
      withWorkerRole(db, "dm_ai_worker", async (trx) =>
        consumeInboxMessage(trx, {
          inboxId: createUuidV7(),
          consumerName: "resilience-consumer",
          messageId: eventId,
          eventType: "ops.probe.v1",
          payload: { probeKey: "resilience" },
          effect: async () => {
            effectCount += 1;
            return { ok: true };
          },
        }),
      );

    expect((await deliver()).kind).toBe("processed");
    expect(effectCount).toBe(1);

    // Operator replay + second at-least-once delivery.
    await withWorkerRole(db, "dm_outbox_worker", async (trx) => {
      await replayOutboxEvent(trx, eventId);
      const rows = await claimOutboxBatch(trx);
      expect(rows.some((row) => row.id === eventId)).toBe(true);
      await markOutboxPublished(trx, eventId);
    });

    expect((await deliver()).kind).toBe("duplicate");
    expect(effectCount).toBe(1);
  });
});
