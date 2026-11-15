import { describe, expect, it } from "vitest";

import { canonicalizeJson, canonicalizeRequest } from "./canonicalize.js";
import { hashCanonicalRequest, sha256Hex } from "./hash.js";
import { assertIdempotencyKey, isIdempotencyKey } from "./key.js";
import { expiresAtFromNow, idempotencyRetentionMs } from "./retention.js";

describe("canonicalizeJson", () => {
  it("sorts object keys deterministically", () => {
    expect(canonicalizeJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalizeJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalizeJson([2, 1])).toBe("[2,1]");
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalizeJson(Number.NaN)).toThrow(/non-finite/);
  });
});

describe("hashCanonicalRequest", () => {
  it("is stable for equivalent bodies with different key order", () => {
    const a = hashCanonicalRequest({
      method: "post",
      path: "/v1/learning/sessions",
      body: { unitId: "u1", platform: "web" },
    });
    const b = hashCanonicalRequest({
      method: "POST",
      path: "/v1/learning/sessions",
      body: { platform: "web", unitId: "u1" },
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when body changes", () => {
    const a = hashCanonicalRequest({
      method: "POST",
      path: "/v1/x",
      body: { n: 1 },
    });
    const b = hashCanonicalRequest({
      method: "POST",
      path: "/v1/x",
      body: { n: 2 },
    });
    expect(a).not.toBe(b);
  });

  it("matches sha256 of canonicalizeRequest", () => {
    const material = canonicalizeRequest({
      method: "PUT",
      path: "/v1/profile",
      body: null,
    });
    expect(hashCanonicalRequest({ method: "PUT", path: "/v1/profile", body: null })).toBe(
      sha256Hex(material),
    );
  });
});

describe("Idempotency-Key", () => {
  it("accepts OpenAPI visible ASCII keys", () => {
    expect(isIdempotencyKey("a")).toBe(true);
    expect(isIdempotencyKey("client-key_1")).toBe(true);
    expect(assertIdempotencyKey("ok")).toBe("ok");
  });

  it("rejects empty, spaces, and overlong keys", () => {
    expect(isIdempotencyKey("")).toBe(false);
    expect(isIdempotencyKey("has space")).toBe(false);
    expect(isIdempotencyKey("x".repeat(129))).toBe(false);
  });
});

describe("retention", () => {
  it("uses 400 days for attempts/purchases and 24h otherwise", () => {
    expect(idempotencyRetentionMs("attempt")).toBe(400 * 24 * 60 * 60 * 1000);
    expect(idempotencyRetentionMs("purchase")).toBe(400 * 24 * 60 * 60 * 1000);
    expect(idempotencyRetentionMs("default")).toBe(24 * 60 * 60 * 1000);
    const now = new Date("2026-07-29T12:00:00.000Z");
    expect(expiresAtFromNow("default", now).toISOString()).toBe("2026-07-30T12:00:00.000Z");
  });
});
