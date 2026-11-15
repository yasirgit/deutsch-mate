/**
 * Runtime Zod schemas for cross-process domain event envelopes
 * (CODING_STANDARDS §11; ADR-012). Consumers reject unsupported versions.
 */

import { z } from "zod";

const UuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "expected UUID",
  );

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "expected sha256 hex");

/**
 * Stable envelope fields shared by outbox rows and consumer deliveries.
 * Payload shape is event-type-specific and validated by per-event schemas.
 */
export const DomainEventEnvelopeSchema = z
  .object({
    eventId: UuidSchema,
    eventType: z.string().min(1).max(100),
    eventVersion: z.number().int().positive(),
    aggregateType: z.string().min(1).max(50),
    aggregateId: UuidSchema,
    occurredAt: z.string().datetime({ offset: true }),
    correlationId: UuidSchema,
    causationId: UuidSchema.nullable(),
    payload: z.record(z.string(), z.unknown()),
    headers: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type DomainEventEnvelope = z.infer<typeof DomainEventEnvelopeSchema>;

/** Minimal probe event used by messaging integration tests (version 1). */
export const ProbeEventV1PayloadSchema = z
  .object({
    probeKey: z.string().min(1).max(128),
    note: z.string().max(256).optional(),
  })
  .strict();

export type ProbeEventV1Payload = z.infer<typeof ProbeEventV1PayloadSchema>;

export const ProbeEventV1Schema = DomainEventEnvelopeSchema.extend({
  eventType: z.literal("ops.probe.v1"),
  eventVersion: z.literal(1),
  payload: ProbeEventV1PayloadSchema,
});

export type ProbeEventV1 = z.infer<typeof ProbeEventV1Schema>;

export function parseDomainEventEnvelope(input: unknown): DomainEventEnvelope {
  return DomainEventEnvelopeSchema.parse(input);
}

export function parseProbeEventV1(input: unknown): ProbeEventV1 {
  return ProbeEventV1Schema.parse(input);
}

/** Emitted when a deterministic (or later verified AI) attempt is scored. */
export const LearningAttemptScoredV1PayloadSchema = z
  .object({
    attemptId: UuidSchema,
    sessionId: UuidSchema,
    userId: UuidSchema,
    activityVersionId: UuidSchema,
    algorithmVersion: z.string().min(1).max(40),
    scoringMethod: z.enum(["deterministic", "verified_ai"]),
    score: z.string().min(1).max(32),
    maxScore: z.string().min(1).max(32),
    passed: z.boolean(),
  })
  .strict();

export type LearningAttemptScoredV1Payload = z.infer<
  typeof LearningAttemptScoredV1PayloadSchema
>;

export const LearningAttemptScoredV1Schema = DomainEventEnvelopeSchema.extend({
  eventType: z.literal("learning.attempt.scored.v1"),
  eventVersion: z.literal(1),
  payload: LearningAttemptScoredV1PayloadSchema,
});

export type LearningAttemptScoredV1 = z.infer<typeof LearningAttemptScoredV1Schema>;

export function parseLearningAttemptScoredV1(input: unknown): LearningAttemptScoredV1 {
  return LearningAttemptScoredV1Schema.parse(input);
}

export { Sha256HexSchema, UuidSchema };
