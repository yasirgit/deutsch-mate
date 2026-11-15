export {
  canonicalizeJson,
  canonicalizeRequest,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
} from "./canonicalize.js";
export { hashCanonicalRequest, isSha256Hex, sha256Hex } from "./hash.js";
export { assertIdempotencyKey, isIdempotencyKey } from "./key.js";
export {
  IDEMPOTENCY_RETENTION,
  expiresAtFromNow,
  idempotencyRetentionMs,
  type IdempotencyRetentionKind,
} from "./retention.js";

export type IdempotencyKeyState = "processing" | "completed" | "failed";

export type IdempotencyOutcome =
  | { readonly kind: "acquired"; readonly id: string }
  | {
      readonly kind: "replay";
      readonly id: string;
      readonly responseStatus: number;
      readonly responseBody: unknown;
      readonly resourceType: string | null;
      readonly resourceId: string | null;
    }
  | { readonly kind: "conflict"; readonly id: string }
  | { readonly kind: "in_progress"; readonly id: string };
