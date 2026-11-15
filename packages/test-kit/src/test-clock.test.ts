import { describe, expect, it } from "vitest";

import { createTestClock } from "./test-clock.js";

describe("createTestClock", () => {
  it("returns the configured start instant", () => {
    const clock = createTestClock(new Date("2026-07-29T12:00:00.000Z"));

    expect(clock.now().toISOString()).toBe("2026-07-29T12:00:00.000Z");
  });

  it("advances deterministically by the requested duration", () => {
    const clock = createTestClock(new Date("2026-07-29T12:00:00.000Z"));

    clock.advanceByMs(90_000);

    expect(clock.now().toISOString()).toBe("2026-07-29T12:01:30.000Z");
  });
});
