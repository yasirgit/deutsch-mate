/**
 * Canonical JSON for idempotency request hashing (docs/API.md).
 * Deterministic key order and encoding so semantically equal bodies hash equal.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * Produces a canonical JSON string: object keys sorted lexicographically,
 * arrays preserve order, no insignificant whitespace, UTF-8 code units.
 * Throws on non-JSON values (undefined, bigint, function, symbol).
 */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonicalizeJson: non-finite numbers are not allowed.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const out: Record<string, JsonValue> = {};
    for (const key of keys) {
      const child = record[key];
      if (child === undefined) {
        continue;
      }
      out[key] = normalize(child);
    }
    return out;
  }
  throw new Error(`canonicalizeJson: unsupported type ${typeof value}.`);
}

/**
 * Builds the canonical request material hashed for Idempotency-Key replay.
 * Includes HTTP method, path (no query), and canonical body.
 */
export function canonicalizeRequest(input: {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}): string {
  const method = input.method.trim().toUpperCase();
  if (method.length === 0) {
    throw new Error("canonicalizeRequest: method is required.");
  }
  const path = input.path.trim();
  if (!path.startsWith("/")) {
    throw new Error('canonicalizeRequest: path must start with "/".');
  }
  return canonicalizeJson({
    method,
    path,
    body: input.body === undefined ? null : input.body,
  });
}
