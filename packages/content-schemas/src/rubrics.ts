import { z } from "zod";

import { RubricDimensionCodeSchema, ScoreDecimalSchema } from "./enums.js";
import { RubricKeySchema } from "./keys.js";
import { RichTextDocSchema } from "./rich-text.js";

/**
 * MVP writing rubrics: task completion, grammar, vocabulary, and clarity
 * (`docs/Database.md` rubric_versions; FR-024).
 */

export const RubricDimensionSchema = z
  .object({
    code: RubricDimensionCodeSchema,
    title: z.string().min(1).max(80),
    description: RichTextDocSchema,
    maxPoints: ScoreDecimalSchema,
  })
  .strict();

export const RubricScoringRuleSchema = z
  .object({
    kind: z.literal("sum_dimensions"),
    passThreshold: ScoreDecimalSchema,
  })
  .strict();

export const RubricAuthoringSchema = z
  .object({
    rubricKey: RubricKeySchema,
    version: z.number().int().positive(),
    dimensions: z
      .array(RubricDimensionSchema)
      .length(4)
      .superRefine((dims, ctx) => {
        const codes = new Set(dims.map((d) => d.code));
        for (const required of RubricDimensionCodeSchema.options) {
          if (!codes.has(required)) {
            ctx.addIssue({
              code: "custom",
              message: `missing required rubric dimension: ${required}`,
            });
          }
        }
      }),
    scoringRule: RubricScoringRuleSchema,
  })
  .strict();
export type RubricAuthoring = z.infer<typeof RubricAuthoringSchema>;
