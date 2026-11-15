import { describe, expect, it } from "vitest";

import { parseDomainEventEnvelope, parseProbeEventV1 } from "./envelope.js";

describe("DomainEventEnvelopeSchema", () => {
  const valid = {
    eventId: "01900000-0000-7000-8000-000000000010",
    eventType: "ops.probe.v1",
    eventVersion: 1,
    aggregateType: "probe",
    aggregateId: "01900000-0000-7000-8000-000000000011",
    occurredAt: "2026-07-29T12:00:00.000Z",
    correlationId: "01900000-0000-7000-8000-000000000012",
    causationId: null,
    payload: { probeKey: "p1" },
    headers: {},
  };

  it("accepts a valid envelope", () => {
    expect(parseDomainEventEnvelope(valid).eventType).toBe("ops.probe.v1");
    expect(parseProbeEventV1(valid).payload.probeKey).toBe("p1");
  });

  it("rejects unsupported versions on the probe schema", () => {
    expect(() => parseProbeEventV1({ ...valid, eventVersion: 2 })).toThrow();
  });

  it("rejects unknown envelope fields", () => {
    expect(() => parseDomainEventEnvelope({ ...valid, extra: true })).toThrow();
  });
});
