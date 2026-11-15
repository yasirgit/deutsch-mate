import type { UuidV7 } from "@deutsch-mate/api-schemas";

/**
 * Normative tutor SSE event names from `docs/API.md` / `docs/AI_AGENTS.md`.
 * OpenAPI documents `streamTutorRunEvents` as `text/event-stream` but cannot
 * model sequencing; these helpers preserve the documented event vocabulary.
 */
export const TUTOR_SSE_EVENT_NAMES = [
  "run.started",
  "message.delta",
  "message.completed",
  "run.blocked",
  "run.failed",
  "run.completed",
] as const;

export type TutorSseEventName = (typeof TUTOR_SSE_EVENT_NAMES)[number];

export type TutorSseFrame = {
  id?: string;
  event?: string;
  data?: string;
  comments: string[];
};

export type TutorSseEvent =
  | { name: "run.started"; id?: string; data: TutorRunStartedData }
  | { name: "message.delta"; id?: string; data: TutorMessageDeltaData }
  | { name: "message.completed"; id?: string; data: TutorMessageCompletedData }
  | { name: "run.blocked"; id?: string; data: TutorRunTerminalData }
  | { name: "run.failed"; id?: string; data: TutorRunTerminalData }
  | { name: "run.completed"; id?: string; data: TutorRunTerminalData };

export type TutorRunStartedData = {
  runId: UuidV7;
};

export type TutorMessageDeltaData = {
  runId: UuidV7;
  text: string;
};

export type TutorMessageCompletedData = {
  runId: UuidV7;
  contentHash?: string;
};

export type TutorRunTerminalData = {
  runId: UuidV7;
  status?: string;
  disposition?: string | null;
  errorCode?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRunId(data: Record<string, unknown>): UuidV7 | undefined {
  const runId = data["runId"];
  return typeof runId === "string" ? (runId as UuidV7) : undefined;
}

/**
 * Parses one SSE frame (fields separated by newlines, terminated by a blank
 * line per the WHATWG / HTML living standard SSE framing).
 */
export function parseSseFrame(rawFrame: string): TutorSseFrame {
  const frame: TutorSseFrame = { comments: [] };
  for (const line of rawFrame.split(/\r?\n/)) {
    if (line.startsWith(":")) {
      frame.comments.push(line.slice(1).trimStart());
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    switch (field) {
      case "id":
        frame.id = value;
        break;
      case "event":
        frame.event = value;
        break;
      case "data":
        frame.data = frame.data === undefined ? value : `${frame.data}\n${value}`;
        break;
      default:
        break;
    }
  }
  return frame;
}

/**
 * Splits an SSE byte stream chunk buffer into complete frames, returning any
 * trailing partial frame for the next chunk.
 */
export function splitSseFrames(buffer: string): { frames: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  return { frames: parts.filter((part) => part.length > 0), rest };
}

function isTutorSseEventName(value: string): value is TutorSseEventName {
  return (TUTOR_SSE_EVENT_NAMES as readonly string[]).includes(value);
}

/**
 * Interprets a parsed SSE frame as a typed tutor event when the `event` name
 * is one of the normative tutor stream events.
 */
export function decodeTutorSseFrame(frame: TutorSseFrame): TutorSseEvent | undefined {
  if (frame.event === undefined || !isTutorSseEventName(frame.event)) {
    return undefined;
  }
  if (frame.data === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame.data) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const runId = readRunId(parsed);
  if (runId === undefined) {
    return undefined;
  }

  switch (frame.event) {
    case "run.started":
      return {
        name: "run.started",
        ...(frame.id !== undefined ? { id: frame.id } : {}),
        data: { runId },
      };
    case "message.delta": {
      const text = parsed["text"];
      if (typeof text !== "string") {
        return undefined;
      }
      return {
        name: "message.delta",
        ...(frame.id !== undefined ? { id: frame.id } : {}),
        data: { runId, text },
      };
    }
    case "message.completed": {
      const contentHash = parsed["contentHash"];
      return {
        name: "message.completed",
        ...(frame.id !== undefined ? { id: frame.id } : {}),
        data: {
          runId,
          ...(typeof contentHash === "string" ? { contentHash } : {}),
        },
      };
    }
    case "run.blocked":
      return {
        name: "run.blocked",
        ...(frame.id !== undefined ? { id: frame.id } : {}),
        data: terminalData(runId, parsed),
      };
    case "run.failed":
      return {
        name: "run.failed",
        ...(frame.id !== undefined ? { id: frame.id } : {}),
        data: terminalData(runId, parsed),
      };
    case "run.completed":
      return {
        name: "run.completed",
        ...(frame.id !== undefined ? { id: frame.id } : {}),
        data: terminalData(runId, parsed),
      };
  }
}

function terminalData(runId: UuidV7, parsed: Record<string, unknown>): TutorRunTerminalData {
  const status = parsed["status"];
  const disposition = parsed["disposition"];
  const errorCode = parsed["errorCode"];
  return {
    runId,
    ...(typeof status === "string" ? { status } : {}),
    ...(disposition === null || typeof disposition === "string" ? { disposition } : {}),
    ...(errorCode === null || typeof errorCode === "string" ? { errorCode } : {}),
  };
}

/**
 * Async-iterates typed tutor SSE events from a fetch `Response` body.
 * Heartbeat comment frames are skipped. Unknown event names are skipped.
 */
export async function* iterateTutorSseEvents(
  body: ReadableStream<Uint8Array> | null,
  options?: { signal?: AbortSignal },
): AsyncGenerator<TutorSseEvent, void, undefined> {
  if (body === null) {
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (options?.signal?.aborted) {
        break;
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = splitSseFrames(buffer);
      buffer = rest;
      for (const raw of frames) {
        const frame = parseSseFrame(raw);
        const event = decodeTutorSseFrame(frame);
        if (event !== undefined) {
          yield event;
        }
      }
    }
    if (buffer.trim().length > 0) {
      const event = decodeTutorSseFrame(parseSseFrame(buffer));
      if (event !== undefined) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
