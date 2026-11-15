/**
 * Idempotency integration tests (DM-023; docs/API.md).
 */

import { hashCanonicalRequest } from "@deutsch-mate/domain";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../kysely.js";
import { claimIdempotencyKey, completeIdempotencyKey } from "./idempotency.js";
import {
  createMigratedTestDatabase,
  createUuidV7,
  seedLearnerUser,
  withApiRole,
} from "./test-harness.js";

describe("idempotency", () => {
  let db: Kysely<Database>;
  let dispose: () => Promise<void>;
  let userId: string;
  let correlationId: string;

  beforeAll(async () => {
    const harness = await createMigratedTestDatabase("deutsch_mate_dm023_idempotency");
    db = harness.db;
    dispose = harness.dispose;
    userId = await seedLearnerUser(db);
    correlationId = createUuidV7();
  }, 120_000);

  afterAll(async () => {
    await dispose();
  });

  it("replays the same outcome for the same key and canonical hash", async () => {
    const requestHash = hashCanonicalRequest({
      method: "POST",
      path: "/v1/learning/sessions",
      body: { unitId: "u1", platform: "web" },
    });
    const key = `session-${createUuidV7()}`;
    const id = createUuidV7();
    const resourceId = createUuidV7();

    const first = await withApiRole(db, { userId, correlationId }, async (trx) => {
      const outcome = await claimIdempotencyKey(trx, {
        id,
        scope: "learning.sessions.create",
        actorUserId: userId,
        key,
        requestHash,
        retention: "default",
      });
      expect(outcome.kind).toBe("acquired");
      await completeIdempotencyKey(trx, {
        id,
        responseStatus: 201,
        responseBody: { id: "sess-1", resourceType: "learning.sessions" },
        resourceType: "learning.sessions",
        resourceId,
      });
      return outcome;
    });
    expect(first.kind).toBe("acquired");

    const second = await withApiRole(db, { userId, correlationId }, async (trx) =>
      claimIdempotencyKey(trx, {
        id: createUuidV7(),
        scope: "learning.sessions.create",
        actorUserId: userId,
        key,
        requestHash,
        retention: "default",
      }),
    );

    expect(second.kind).toBe("replay");
    if (second.kind === "replay") {
      expect(second.responseStatus).toBe(201);
      expect(second.responseBody).toEqual({
        id: "sess-1",
        resourceType: "learning.sessions",
      });
    }
  });

  it("returns conflict when the same key is reused with a different hash", async () => {
    const key = `conflict-${createUuidV7()}`;
    const hashA = hashCanonicalRequest({
      method: "POST",
      path: "/v1/x",
      body: { n: 1 },
    });
    const hashB = hashCanonicalRequest({
      method: "POST",
      path: "/v1/x",
      body: { n: 2 },
    });

    await withApiRole(db, { userId, correlationId }, async (trx) => {
      const outcome = await claimIdempotencyKey(trx, {
        id: createUuidV7(),
        scope: "probe.command",
        actorUserId: userId,
        key,
        requestHash: hashA,
        retention: "default",
      });
      expect(outcome.kind).toBe("acquired");
      if (outcome.kind === "acquired") {
        await completeIdempotencyKey(trx, {
          id: outcome.id,
          responseStatus: 200,
          responseBody: { ok: true },
        });
      }
    });

    const conflict = await withApiRole(db, { userId, correlationId }, async (trx) =>
      claimIdempotencyKey(trx, {
        id: createUuidV7(),
        scope: "probe.command",
        actorUserId: userId,
        key,
        requestHash: hashB,
        retention: "default",
      }),
    );
    expect(conflict.kind).toBe("conflict");
  });
});
