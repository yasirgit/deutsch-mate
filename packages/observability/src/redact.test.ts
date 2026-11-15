import { describe, expect, it } from "vitest";

import { REDACTED, containsProhibitedTelemetry, redactForTelemetry } from "./redact.js";

describe("redactForTelemetry", () => {
  it("redacts Authorization bearer tokens by key and value", () => {
    const result = redactForTelemetry({
      Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
      note: "Authorization: Bearer abc.def.ghi",
    }) as Record<string, unknown>;
    expect(result["Authorization"]).toBe(REDACTED);
    expect(String(result["note"])).not.toMatch(/Bearer\s+\S+\.\S+/);
  });

  it("redacts emails", () => {
    expect(redactForTelemetry("contact me at learner@example.com please")).toBe(
      `contact me at ${REDACTED} please`,
    );
    expect(redactForTelemetry({ email: "learner@example.com" })).toEqual({
      email: REDACTED,
    });
  });

  it("redacts raw chat and writing fields by key", () => {
    expect(
      redactForTelemetry({
        chat: "Ich gehe morgen in die Schule.",
        writing: "Mein Lieblingsessen ist Pizza.",
        operation: "tutor.turn",
      }),
    ).toEqual({
      chat: REDACTED,
      writing: REDACTED,
      operation: "tutor.turn",
    });
  });

  it("redacts Stripe secrets and provider payload keys", () => {
    const result = redactForTelemetry({
      stripe_secret_key: "sk_live_51HhExampleSecretKeyValue",
      provider_payload: { id: "evt_123", data: { object: "charge" } },
      note: "key sk_test_51HhExampleSecretKeyValue leaked",
    }) as Record<string, unknown>;
    expect(result["stripe_secret_key"]).toBe(REDACTED);
    expect(result["provider_payload"]).toBe(REDACTED);
    expect(String(result["note"])).toContain(REDACTED);
    expect(String(result["note"])).not.toContain("sk_test_");
  });

  it("redacts card numbers and CVV keys", () => {
    const result = redactForTelemetry({
      pan: "4111 1111 1111 1111",
      cvv: "123",
      note: "card 4111111111111111",
    }) as Record<string, unknown>;
    expect(result["pan"]).toBe(REDACTED);
    expect(result["cvv"]).toBe(REDACTED);
    expect(String(result["note"])).not.toMatch(/4111/);
  });

  it("redacts signed and presigned URLs", () => {
    const url =
      "https://bucket.s3.eu-central-1.amazonaws.com/obj?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abcdef";
    expect(redactForTelemetry(url)).toBe(REDACTED);
    expect(redactForTelemetry({ signed_url: url })).toEqual({ signed_url: REDACTED });
    expect(redactForTelemetry({ presigned_url: url })).toEqual({
      presigned_url: REDACTED,
    });
  });

  it("redacts credentials inside connection strings", () => {
    const result = redactForTelemetry(
      "postgresql://deutsch_mate:super-secret@localhost:54329/deutsch_mate_dev",
    );
    expect(result).toBe(`postgresql://deutsch_mate:${REDACTED}@localhost:54329/deutsch_mate_dev`);
  });

  it("redacts nested structures", () => {
    const result = redactForTelemetry({
      request: {
        headers: { authorization: "Bearer secret-token-value" },
        body: { email: "a@b.co", text: "ok" },
      },
    }) as {
      request: { headers: Record<string, unknown>; body: Record<string, unknown> };
    };
    expect(result.request.headers["authorization"]).toBe(REDACTED);
    expect(result.request.body["email"]).toBe(REDACTED);
    expect(result.request.body["text"]).toBe("ok");
  });
});

describe("containsProhibitedTelemetry", () => {
  it("detects leftover emails and signed URLs", () => {
    expect(containsProhibitedTelemetry("hi learner@example.com")).toBe(true);
    expect(
      containsProhibitedTelemetry(
        "https://x.amazonaws.com/o?X-Amz-Signature=abc&X-Amz-Algorithm=AWS4",
      ),
    ).toBe(true);
    expect(containsProhibitedTelemetry(`safe ${REDACTED} only`)).toBe(false);
  });
});
