import { describe, expect, it } from "vitest";

import { computeAuditEventHash, verifyAuditEventHash } from "./hash-chain.js";

describe("audit hash chain", () => {
  it("is deterministic and includes previousHash", () => {
    const base = {
      id: "01900000-0000-7000-8000-000000000001",
      occurredAt: "2026-07-29T12:00:00.000Z",
      actorUserId: null,
      actorType: "service" as const,
      action: "outbox.publish",
      resourceType: "ops.outbox_events",
      resourceId: "01900000-0000-7000-8000-000000000002",
      outcome: "success" as const,
      reasonCode: null,
      correlationId: "01900000-0000-7000-8000-000000000003",
      metadata: { attempt: 1 },
      previousHash: null,
    };
    const first = computeAuditEventHash(base);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyAuditEventHash(base, first)).toBe(true);

    const second = computeAuditEventHash({ ...base, previousHash: first });
    expect(second).not.toBe(first);
    expect(verifyAuditEventHash({ ...base, previousHash: first }, second)).toBe(true);
  });
});
