/**
 * Pattern constants and validators mirroring `docs/openapi.yaml` primitive
 * schemas. These are not handwritten DTOs — they encode the same patterns the
 * generated types document so clients can validate wire values at runtime.
 *
 * Keep in sync with components.schemas.{UuidV7,Decimal,BigInteger,Problem}
 * via `pnpm openapi:compat`.
 */

/** UUIDv7 pattern from `components.schemas.UuidV7`. */
export const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Decimal-as-string pattern from `components.schemas.Decimal`. */
export const DECIMAL_PATTERN = /^-?[0-9]+(?:\.[0-9]+)?$/;

/** BigInteger-as-string pattern from `components.schemas.BigInteger`. */
export const BIG_INTEGER_PATTERN = /^-?[0-9]+$/;

/** RFC 9457 Problem Details required fields from `components.schemas.Problem`. */
export const PROBLEM_REQUIRED_FIELDS = [
  "type",
  "title",
  "status",
  "detail",
  "instance",
  "requestId",
  "code",
] as const;

export type ProblemRequiredField = (typeof PROBLEM_REQUIRED_FIELDS)[number];

export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}

export function isDecimalString(value: string): boolean {
  return DECIMAL_PATTERN.test(value);
}

export function isBigIntegerString(value: string): boolean {
  return BIG_INTEGER_PATTERN.test(value);
}

export function isProblemDetails(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const field of PROBLEM_REQUIRED_FIELDS) {
    if (!(field in record)) {
      return false;
    }
  }
  return (
    typeof record["type"] === "string" &&
    typeof record["title"] === "string" &&
    typeof record["status"] === "number" &&
    typeof record["detail"] === "string" &&
    typeof record["instance"] === "string" &&
    typeof record["requestId"] === "string" &&
    typeof record["code"] === "string"
  );
}
