/**
 * UUIDv7 generator (docs/Database.md §2.1; docs/API.md).
 * Uses Node crypto for randomness; no Nest/pg imports.
 */

import { randomBytes } from "node:crypto";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}

/**
 * Generates a UUIDv7 string (RFC 9562). Timestamp is Unix epoch milliseconds.
 */
export function createUuidV7(nowMs: number = Date.now()): string {
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new Error("createUuidV7: nowMs must be a non-negative finite number.");
  }
  const ms = Math.floor(nowMs);
  const bytes = randomBytes(16);

  // 48-bit big-endian timestamp
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms / 2 ** 24) & 0xff;
  bytes[3] = (ms / 2 ** 16) & 0xff;
  bytes[4] = (ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;

  // version 7
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  // variant 10
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
