/**
 * Audit append + hash-chain export tests (DM-023).
 */

import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../kysely.js";
import { appendAuditEvent, exportAuditEvents } from "./audit.js";
import {
  createMigratedTestDatabase,
  createUuidV7,
  seedLearnerUser,
  withApiRole,
} from "./test-harness.js";

describe("audit", () => {
  let db: Kysely<Database>;
  let dispose: () => Promise<void>;
  let userId: string;
  let correlationId: string;

  beforeAll(async () => {
    const harness = await createMigratedTestDatabase("deutsch_mate_dm023_audit");
    db = harness.db;
    dispose = harness.dispose;
    userId = await seedLearnerUser(db);
    correlationId = createUuidV7();
  }, 120_000);

  afterAll(async () => {
    await dispose();
  });

  it("appends audit events with a verifiable hash chain", async () => {
    const first = await withApiRole(db, { userId, correlationId }, async (trx) =>
      appendAuditEvent(trx, {
        actorUserId: userId,
        actorType: "user",
        action: "profile.update",
        resourceType: "learner.profile_versions",
        resourceId: createUuidV7(),
        outcome: "success",
        correlationId,
        metadata: { field: "interface_locale" },
      }),
    );

    expect(first.previous_hash).toBeNull();
    expect(first.event_hash).toMatch(/^[0-9a-f]{64}$/);

    const second = await withApiRole(db, { userId, correlationId }, async (trx) =>
      appendAuditEvent(trx, {
        actorUserId: userId,
        actorType: "user",
        action: "consent.accept",
        resourceType: "iam.consent_events",
        resourceId: createUuidV7(),
        outcome: "success",
        correlationId,
        metadata: { document: "terms" },
      }),
    );

    expect(second.previous_hash).toBe(first.event_hash);

    // Export as table owner / superuser (FORCE RLS does not apply to superuser).
    const manifest = await exportAuditEvents(db);
    expect(manifest.eventCount).toBeGreaterThanOrEqual(2);
    expect(manifest.chainValid).toBe(true);
    expect(manifest.lastEventHash).toBe(second.event_hash);
  });
});
