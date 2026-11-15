/**
 * Idempotency-Key header validation (OpenAPI IdempotencyKey parameter).
 * Pattern: 1–128 visible ASCII characters (\\x21-\\x7E).
 */

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,128}$/;

export function isIdempotencyKey(value: string): boolean {
  return IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function assertIdempotencyKey(value: string): string {
  if (!isIdempotencyKey(value)) {
    throw new Error(
      "Idempotency-Key must be 1–128 visible ASCII characters (OpenAPI IdempotencyKey).",
    );
  }
  return value;
}
