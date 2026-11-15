import { describe, expect, it } from "vitest";

import { createLogger } from "./logger.js";
import { REDACTED, containsProhibitedTelemetry } from "./redact.js";

/**
 * Prohibited-data telemetry safety suite (DM-012 acceptance).
 * Invoked by `pnpm test:telemetry-safety`.
 */
describe("telemetry prohibited-data safety", () => {
  it("logger output excludes credentials, emails, chat, Stripe, cards, and signed URLs", () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: "api",
      environment: "test",
      level: "debug",
      sink: (line) => {
        lines.push(line);
      },
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    logger.info("turn completed", {
      authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.aaa.bbb",
      email: "learner@example.com",
      chat: "Wie komme ich zum Bahnhof?",
      writing: "Ich habe gestern Fußball gespielt.",
      provider_payload: { model: "gpt-x", choices: [{ text: "secret" }] },
      stripe_event: { id: "evt_1", type: "invoice.paid" },
      pan: "4111111111111111",
      cvv: "123",
      signed_url:
        "https://media.example/o?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef",
      correlationId: "01HZXAMPLE0000000000000000",
      database_url: "postgresql://user:password@db/app",
    });

    expect(lines).toHaveLength(1);
    const line = lines[0] ?? "";
    expect(containsProhibitedTelemetry(line)).toBe(false);
    expect(line).not.toContain("learner@example.com");
    expect(line).not.toContain("Bahnhof");
    expect(line).not.toContain("Fußball");
    expect(line).not.toContain("4111111111111111");
    expect(line).not.toContain("X-Amz-Signature");
    expect(line).not.toContain("password");
    expect(line).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(line).toContain(REDACTED);
    expect(line).toContain("01HZXAMPLE0000000000000000");
    expect(line).toContain('"service":"api"');
    expect(line).toContain('"severity":"info"');
  });

  it("respects log level filtering", () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: "ai-worker",
      environment: "test",
      level: "warn",
      sink: (line) => {
        lines.push(line);
      },
    });
    logger.info("skipped");
    logger.warn("emitted");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("emitted");
  });
});
