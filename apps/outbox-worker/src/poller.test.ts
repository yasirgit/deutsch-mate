import { describe, expect, it } from "vitest";

import { runOutboxPollCycle } from "./poller.js";
import { LocalRecordingPublisher } from "./publisher.js";

describe("outbox poller", () => {
  it("is exported for worker wiring", () => {
    expect(typeof runOutboxPollCycle).toBe("function");
    expect(new LocalRecordingPublisher().published).toEqual([]);
  });
});
