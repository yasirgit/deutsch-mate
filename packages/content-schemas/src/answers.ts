import { z } from "zod";

import { BlankIdSchema, OptionIdSchema, ScoringAlgorithmVersionSchema } from "./keys.js";
import { RichTextDocSchema } from "./rich-text.js";
import { ScoreDecimalSchema } from "./enums.js";

/**
 * Deterministic answer specifications for scored activities.
 * Supports exact, case-folded, normalized, set, ordered, matching, and
 * weighted alternatives (`docs/Database.md` answer_key_versions).
 *
 * Executable expressions, scripts, and eval-like kinds are forbidden.
 */

const AnswerTextSchema = z.string().min(1).max(500);

export const ExactAnswerSpecSchema = z
  .object({
    kind: z.literal("exact"),
    value: AnswerTextSchema,
  })
  .strict();

export const CaseFoldedAnswerSpecSchema = z
  .object({
    kind: z.literal("case_folded"),
    value: AnswerTextSchema,
  })
  .strict();

export const NormalizedAnswerSpecSchema = z
  .object({
    kind: z.literal("normalized"),
    value: AnswerTextSchema,
  })
  .strict();

export const SetAnswerSpecSchema = z
  .object({
    kind: z.literal("set"),
    values: z.array(OptionIdSchema).min(1).max(20),
  })
  .strict();

export const OrderedAnswerSpecSchema = z
  .object({
    kind: z.literal("ordered"),
    order: z.array(OptionIdSchema).min(2).max(20),
  })
  .strict();

export const MatchingAnswerSpecSchema = z
  .object({
    kind: z.literal("matching"),
    pairs: z
      .array(
        z
          .object({
            leftId: OptionIdSchema,
            rightId: OptionIdSchema,
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

const AlternativeWeightSchema = z
  .string()
  .regex(/^0\.[0-9]{1,3}$|^1(?:\.0{1,3})?$/, "weight in (0,1] as decimal string");

export const WeightedAlternativesAnswerSpecSchema = z
  .object({
    kind: z.literal("weighted_alternatives"),
    alternatives: z
      .array(
        z
          .object({
            value: AnswerTextSchema,
            weight: AlternativeWeightSchema,
            match: z.enum(["exact", "case_folded", "normalized"]),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

const BlankAcceptSchema = z.discriminatedUnion("kind", [
  ExactAnswerSpecSchema,
  CaseFoldedAnswerSpecSchema,
  NormalizedAnswerSpecSchema,
  WeightedAlternativesAnswerSpecSchema,
]);

export const ClozeAnswerSpecSchema = z
  .object({
    kind: z.literal("cloze"),
    blanks: z
      .array(
        z
          .object({
            blankId: BlankIdSchema,
            accept: BlankAcceptSchema,
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

export const AnswerSpecSchema = z.discriminatedUnion("kind", [
  ExactAnswerSpecSchema,
  CaseFoldedAnswerSpecSchema,
  NormalizedAnswerSpecSchema,
  SetAnswerSpecSchema,
  OrderedAnswerSpecSchema,
  MatchingAnswerSpecSchema,
  WeightedAlternativesAnswerSpecSchema,
  ClozeAnswerSpecSchema,
]);
export type AnswerSpec = z.infer<typeof AnswerSpecSchema>;

/** Kinds that must never be accepted as answer expressions. */
export const FORBIDDEN_ANSWER_SPEC_KINDS = [
  "expression",
  "eval",
  "script",
  "regex_exec",
  "javascript",
  "code",
  "formula",
] as const;

export const AnswerKeyAuthoringSchema = z
  .object({
    version: z.number().int().positive(),
    scoringAlgorithmVersion: ScoringAlgorithmVersionSchema,
    answerSpec: AnswerSpecSchema,
    rationale: RichTextDocSchema.optional(),
    maxScore: ScoreDecimalSchema,
  })
  .strict();
export type AnswerKeyAuthoring = z.infer<typeof AnswerKeyAuthoringSchema>;
