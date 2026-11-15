/**
 * SHA-256 request hashing for Idempotency-Key semantics (docs/API.md).
 */

import { createHash } from "node:crypto";

import { canonicalizeRequest } from "./canonicalize.js";

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value);
}

/** Lowercase hex SHA-256 of arbitrary UTF-8 text. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Hashes the canonical request (method + path + body) to a 64-char hex digest
 * stored in `ops.idempotency_keys.request_hash`.
 */
export function hashCanonicalRequest(input: {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}): string {
  return sha256Hex(canonicalizeRequest(input));
}
