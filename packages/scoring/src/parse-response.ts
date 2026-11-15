/**
 * Map OpenAPI AttemptResponseInput bodies onto LearnerResponse.
 */

import type { LearnerResponse } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  if (!value.every((item) => typeof item === "string")) {
    return null;
  }
  return value;
}

/**
 * Extract a scorable learner response from stored attempt_responses fields.
 */
export function parseLearnerResponse(input: {
  readonly responseKind: string;
  readonly response?: unknown;
  readonly textContent?: string | null;
}): LearnerResponse {
  if (input.responseKind === "text") {
    const text = input.textContent ?? "";
    return text.length === 0 ? { kind: "empty" } : { kind: "text", text };
  }

  const body = input.response;
  if (!isRecord(body)) {
    return { kind: "empty" };
  }

  if (typeof body["value"] === "string") {
    return { kind: "text", text: body["value"] };
  }
  if (typeof body["text"] === "string") {
    return { kind: "text", text: body["text"] };
  }

  const selected = asStringArray(body["selected"]);
  if (selected !== null) {
    return { kind: "selected", selected };
  }

  const order = asStringArray(body["order"]);
  if (order !== null) {
    return { kind: "order", order };
  }

  if (Array.isArray(body["pairs"])) {
    const pairs: { leftId: string; rightId: string }[] = [];
    for (const item of body["pairs"]) {
      if (!isRecord(item)) {
        continue;
      }
      if (typeof item["leftId"] === "string" && typeof item["rightId"] === "string") {
        pairs.push({ leftId: item["leftId"], rightId: item["rightId"] });
      }
    }
    return { kind: "pairs", pairs };
  }

  if (isRecord(body["blanks"])) {
    const blanks: Record<string, string> = {};
    for (const [key, value] of Object.entries(body["blanks"])) {
      if (typeof value === "string") {
        blanks[key] = value;
      }
    }
    return { kind: "blanks", blanks };
  }

  if (Array.isArray(body["blanks"])) {
    const blanks: Record<string, string> = {};
    for (const item of body["blanks"]) {
      if (!isRecord(item)) {
        continue;
      }
      if (typeof item["blankId"] === "string" && typeof item["value"] === "string") {
        blanks[item["blankId"]] = item["value"];
      }
    }
    return { kind: "blanks", blanks };
  }

  return { kind: "empty" };
}
