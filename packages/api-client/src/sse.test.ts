import { describe, expect, it } from "vitest";

import {
  TUTOR_SSE_EVENT_NAMES,
  decodeTutorSseFrame,
  parseSseFrame,
  splitSseFrames,
} from "./sse.js";

describe("tutor SSE helpers", () => {
  it("exposes the normative event vocabulary from docs/API.md", () => {
    expect([...TUTOR_SSE_EVENT_NAMES]).toEqual([
      "run.started",
      "message.delta",
      "message.completed",
      "run.blocked",
      "run.failed",
      "run.completed",
    ]);
  });

  it("parses the OpenAPI streamTutorRunEvents example frame", () => {
    const example =
      'id: 12\nevent: message.delta\ndata: {"runId":"018fa5c2-7b1d-7abc-8def-0123456789ab","text":"Guten"}';
    const frame = parseSseFrame(example);
    expect(frame).toEqual({
      id: "12",
      event: "message.delta",
      data: '{"runId":"018fa5c2-7b1d-7abc-8def-0123456789ab","text":"Guten"}',
      comments: [],
    });
    expect(decodeTutorSseFrame(frame)).toEqual({
      name: "message.delta",
      id: "12",
      data: {
        runId: "018fa5c2-7b1d-7abc-8def-0123456789ab",
        text: "Guten",
      },
    });
  });

  it("splits frames and ignores heartbeat comments", () => {
    const { frames, rest } = splitSseFrames(
      ': heartbeat\n\nid: 1\nevent: run.started\ndata: {"runId":"018fa5c2-7b1d-7abc-8def-0123456789ab"}\n\npartial',
    );
    expect(frames).toHaveLength(2);
    expect(rest).toBe("partial");
    expect(decodeTutorSseFrame(parseSseFrame(frames[0]!))).toBeUndefined();
    expect(decodeTutorSseFrame(parseSseFrame(frames[1]!))?.name).toBe("run.started");
  });
});
