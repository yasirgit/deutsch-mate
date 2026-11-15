import { describe, expect, it } from "vitest";

import {
  BIG_INTEGER_PATTERN,
  DECIMAL_PATTERN,
  UUID_V7_PATTERN,
  isBigIntegerString,
  isDecimalString,
  isProblemDetails,
  isUuidV7,
} from "./primitives.js";

describe("OpenAPI primitive validators", () => {
  it("accepts the UuidV7 example from docs/openapi.yaml", () => {
    expect(isUuidV7("018fa5c2-7b1d-7abc-8def-0123456789ab")).toBe(true);
    expect(UUID_V7_PATTERN.test("018fa5c2-7b1d-4abc-8def-0123456789ab")).toBe(false);
  });

  it("keeps Decimal and BigInteger as string patterns", () => {
    expect(isDecimalString("0.85000")).toBe(true);
    expect(isBigIntegerString("1499")).toBe(true);
    expect(DECIMAL_PATTERN.test("not-a-decimal")).toBe(false);
    expect(BIG_INTEGER_PATTERN.test("1.5")).toBe(false);
  });

  it("requires RFC 9457 Problem fields from the contract", () => {
    expect(
      isProblemDetails({
        type: "https://api.deutschmate.example/problems/validation-failed",
        title: "Validation failed",
        status: 400,
        detail: "One or more fields are invalid.",
        instance: "/v1/me/profile",
        requestId: "018fa5c2-7b1d-7abc-8def-0123456789ab",
        code: "validation_failed",
      }),
    ).toBe(true);
    expect(isProblemDetails({ title: "missing fields" })).toBe(false);
  });
});
