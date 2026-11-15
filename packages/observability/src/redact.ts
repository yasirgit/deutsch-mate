/**
 * Redaction helpers for structured telemetry (DM-012; NFR-011; ADR-017/018).
 *
 * Redaction is a secondary control — callers must still avoid collecting
 * prohibited data. These helpers scrub leftovers before emission.
 */

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|secret|password|passwd|token|access[_-]?token|refresh[_-]?token|id[_-]?token|private[_-]?key|client[_-]?secret|stripe[_-]?(secret|key|webhook)|openai[_-]?api[_-]?key|database_url|redis_url|connection[_-]?string|card|pan|cvv|cvc|cvc2|expiry|exp[_-]?month|exp[_-]?year|payment[_-]?method|raw[_-]?(body|payload))$/i;

const PROHIBITED_CONTENT_KEY =
  /^(email|e[_-]?mail|chat|message|messages|writing|essay|transcript|prompt|completion|learner[_-]?text|raw[_-]?content|conversation|tutor[_-]?message|stripe[_-]?(event|payload|object)|provider[_-]?(payload|response|body)|signed[_-]?url|presigned[_-]?url)$/i;

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

const AWS_SIGNED_URL_PATTERN =
  /https?:\/\/[^\s"'<>]*[?&](?:X-Amz-Algorithm|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|Signature|AWSAccessKeyId)=[^\s"'<>]*/gi;

const GENERIC_SIGNED_URL_PATTERN =
  /https?:\/\/[^\s"'<>]*[?&](?:X-Amz-Signature|Signature|sig|token)=[^\s"'<>]*/gi;

const STRIPE_SECRET_PATTERN = /\b(?:sk|rk|whsec)_(?:live|test)_[A-Za-z0-9]+\b/g;

const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9]{20,}\b/g;

const CARD_NUMBER_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;

const CONNECTION_STRING_PASSWORD_PATTERN =
  /\b((?:postgres|postgresql|mysql|mongodb|redis|rediss):\/\/[^/\s:'"]+):([^@/\s]+)@/gi;

const AUTHORIZATION_HEADER_VALUE = /^(?:\s*Bearer\s+).+/i;

function scrubString(value: string): string {
  let result = value;
  result = result.replace(CONNECTION_STRING_PASSWORD_PATTERN, `$1:${REDACTED}@`);
  result = result.replace(AWS_SIGNED_URL_PATTERN, REDACTED);
  result = result.replace(GENERIC_SIGNED_URL_PATTERN, REDACTED);
  result = result.replace(BEARER_PATTERN, `Bearer ${REDACTED}`);
  result = result.replace(JWT_PATTERN, REDACTED);
  result = result.replace(STRIPE_SECRET_PATTERN, REDACTED);
  result = result.replace(OPENAI_KEY_PATTERN, REDACTED);
  result = result.replace(EMAIL_PATTERN, REDACTED);
  result = result.replace(CARD_NUMBER_PATTERN, REDACTED);
  if (AUTHORIZATION_HEADER_VALUE.test(result) && !result.includes(REDACTED)) {
    return REDACTED;
  }
  return result;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || PROHIBITED_CONTENT_KEY.test(key);
}

/**
 * Deep-redacts a value for logs, spans, metrics attributes, and alerts.
 * Objects keyed by sensitive or prohibited-content names are replaced entirely.
 */
export function redactForTelemetry(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return scrubString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactForTelemetry(entry));
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
    };
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        output[key] = REDACTED;
        continue;
      }
      output[key] = redactForTelemetry(entry);
    }
    return output;
  }
  return REDACTED;
}

/**
 * Returns true when a string still appears to contain prohibited telemetry
 * material. Used by safety tests and optional debug assertions.
 */
export function containsProhibitedTelemetry(value: string): boolean {
  if (value.includes(REDACTED) && value === REDACTED) {
    return false;
  }
  const probes: RegExp[] = [
    EMAIL_PATTERN,
    BEARER_PATTERN,
    JWT_PATTERN,
    AWS_SIGNED_URL_PATTERN,
    STRIPE_SECRET_PATTERN,
    OPENAI_KEY_PATTERN,
    /sk_live_|sk_test_|whsec_/,
    /X-Amz-Signature=/i,
  ];
  for (const pattern of probes) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) {
      return true;
    }
  }
  return false;
}
