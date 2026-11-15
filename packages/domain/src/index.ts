/**
 * Pure domain package (docs/CODING_STANDARDS.md §5).
 * Framework, provider, and transport imports are forbidden here.
 */

export { createUuidV7, isUuidV7 } from "./ids/uuidv7.js";

export {
  IDEMPOTENCY_RETENTION,
  assertIdempotencyKey,
  canonicalizeJson,
  canonicalizeRequest,
  expiresAtFromNow,
  hashCanonicalRequest,
  idempotencyRetentionMs,
  isIdempotencyKey,
  isSha256Hex,
  sha256Hex,
  type IdempotencyKeyState,
  type IdempotencyOutcome,
  type IdempotencyRetentionKind,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
} from "./idempotency/index.js";

export {
  DomainEventEnvelopeSchema,
  LearningAttemptScoredV1PayloadSchema,
  LearningAttemptScoredV1Schema,
  ProbeEventV1PayloadSchema,
  ProbeEventV1Schema,
  Sha256HexSchema,
  UuidSchema,
  parseDomainEventEnvelope,
  parseLearningAttemptScoredV1,
  parseProbeEventV1,
  type DomainEventEnvelope,
  type LearningAttemptScoredV1,
  type LearningAttemptScoredV1Payload,
  type ProbeEventV1,
  type ProbeEventV1Payload,
} from "./events/index.js";

export {
  computeAuditEventHash,
  verifyAuditEventHash,
  type AuditActorType,
  type AuditHashInput,
  type AuditOutcome,
} from "./audit/index.js";

export const DOMAIN_PACKAGE_NAME = "@deutsch-mate/domain";
