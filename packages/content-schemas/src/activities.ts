import { z } from "zod";

import { AnswerKeyAuthoringSchema } from "./answers.js";
import { ActivityAssetAuthoringSchema } from "./assets.js";
import {
  ActivityTypeSchema,
  CefrLevelSchema,
  ObjectiveWeightSchema,
  OrdinalSchema,
  ScoreDecimalSchema,
  TranscriptPolicySchema,
} from "./enums.js";
import { ActivityKeySchema, BlankIdSchema, ObjectiveKeySchema, OptionIdSchema } from "./keys.js";
import { RichTextDocSchema } from "./rich-text.js";
import { RubricAuthoringSchema } from "./rubrics.js";

const ActivityObjectiveLinkSchema = z
  .object({
    objectiveKey: ObjectiveKeySchema,
    objectiveVersion: z.number().int().positive(),
    weight: ObjectiveWeightSchema,
  })
  .strict();

const SelectionOptionSchema = z
  .object({
    id: OptionIdSchema,
    label: RichTextDocSchema,
  })
  .strict();

const MatchingSideSchema = z
  .object({
    id: OptionIdSchema,
    label: RichTextDocSchema,
  })
  .strict();

const OrderingItemSchema = z
  .object({
    id: OptionIdSchema,
    label: RichTextDocSchema,
  })
  .strict();

const ClozeSegmentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      text: z.string().min(1).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal("blank"),
      blankId: BlankIdSchema,
    })
    .strict(),
]);

const ExplanationConfigSchema = z
  .object({
    body: RichTextDocSchema,
  })
  .strict();

const SelectionConfigSchema = z
  .object({
    mode: z.enum(["single", "multi"]),
    options: z.array(SelectionOptionSchema).min(2).max(12),
  })
  .strict();

const MatchingConfigSchema = z
  .object({
    left: z.array(MatchingSideSchema).min(2).max(12),
    right: z.array(MatchingSideSchema).min(2).max(12),
  })
  .strict();

const OrderingConfigSchema = z
  .object({
    items: z.array(OrderingItemSchema).min(2).max(12),
  })
  .strict();

const ClozeConfigSchema = z
  .object({
    segments: z.array(ClozeSegmentSchema).min(2).max(40),
  })
  .strict();

const TypedResponseConfigSchema = z
  .object({
    maxLength: z.number().int().min(1).max(200),
    inputHint: z.string().min(1).max(120).optional(),
  })
  .strict();

const ListeningItemSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("selection"),
      prompt: RichTextDocSchema,
      configuration: SelectionConfigSchema,
      answerKey: AnswerKeyAuthoringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("cloze"),
      prompt: RichTextDocSchema,
      configuration: ClozeConfigSchema,
      answerKey: AnswerKeyAuthoringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("typed_response"),
      prompt: RichTextDocSchema,
      configuration: TypedResponseConfigSchema,
      answerKey: AnswerKeyAuthoringSchema,
    })
    .strict(),
]);

const ListeningConfigSchema = z
  .object({
    items: z.array(ListeningItemSchema).min(1).max(10),
  })
  .strict();

const WritingConfigSchema = z
  .object({
    minChars: z.number().int().min(1).max(2000),
    maxChars: z.number().int().min(1).max(2000),
    guidance: RichTextDocSchema.optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    if (cfg.minChars > cfg.maxChars) {
      ctx.addIssue({
        code: "custom",
        message: "minChars must be <= maxChars",
        path: ["minChars"],
      });
    }
  });

const FormativeItemSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("selection"),
      prompt: RichTextDocSchema,
      configuration: SelectionConfigSchema,
      answerKey: AnswerKeyAuthoringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("matching"),
      prompt: RichTextDocSchema,
      configuration: MatchingConfigSchema,
      answerKey: AnswerKeyAuthoringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("ordering"),
      prompt: RichTextDocSchema,
      configuration: OrderingConfigSchema,
      answerKey: AnswerKeyAuthoringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("cloze"),
      prompt: RichTextDocSchema,
      configuration: ClozeConfigSchema,
      answerKey: AnswerKeyAuthoringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("typed_response"),
      prompt: RichTextDocSchema,
      configuration: TypedResponseConfigSchema,
      answerKey: AnswerKeyAuthoringSchema,
    })
    .strict(),
]);

const FormativeCheckConfigSchema = z
  .object({
    items: z.array(FormativeItemSchema).min(1).max(20),
  })
  .strict();

const ActivityBaseFields = {
  schemaVersion: z.literal(1),
  activityKey: ActivityKeySchema,
  version: z.number().int().positive(),
  level: CefrLevelSchema,
  prompt: RichTextDocSchema,
  maxScore: ScoreDecimalSchema,
  required: z.boolean(),
  objectives: z.array(ActivityObjectiveLinkSchema).min(1).max(8),
  assets: z.array(ActivityAssetAuthoringSchema).max(8),
} as const;

export const ExplanationActivitySchema = z
  .object({
    ...ActivityBaseFields,
    type: z.literal("explanation"),
    configuration: ExplanationConfigSchema,
    transcriptPolicy: z.null(),
  })
  .strict()
  .superRefine((activity, ctx) => {
    if (activity.maxScore !== "0" && activity.maxScore !== "0.0" && activity.maxScore !== "0.000") {
      ctx.addIssue({
        code: "custom",
        message: "explanation activities must have maxScore 0",
        path: ["maxScore"],
      });
    }
  });

export const SelectionActivitySchema = z
  .object({
    ...ActivityBaseFields,
    type: z.literal("selection"),
    configuration: SelectionConfigSchema,
    transcriptPolicy: z.null(),
    answerKey: AnswerKeyAuthoringSchema,
  })
  .strict();

export const MatchingActivitySchema = z
  .object({
    ...ActivityBaseFields,
    type: z.literal("matching"),
    configuration: MatchingConfigSchema,
    transcriptPolicy: z.null(),
    answerKey: AnswerKeyAuthoringSchema,
  })
  .strict();

export const OrderingActivitySchema = z
  .object({
    ...ActivityBaseFields,
    type: z.literal("ordering"),
    configuration: OrderingConfigSchema,
    transcriptPolicy: z.null(),
    answerKey: AnswerKeyAuthoringSchema,
  })
  .strict();

export const ClozeActivitySchema = z
  .object({
    ...ActivityBaseFields,
    type: z.literal("cloze"),
    configuration: ClozeConfigSchema,
    transcriptPolicy: z.null(),
    answerKey: AnswerKeyAuthoringSchema,
  })
  .strict();

export const TypedResponseActivitySchema = z
  .object({
    ...ActivityBaseFields,
    type: z.literal("typed_response"),
    configuration: TypedResponseConfigSchema,
    transcriptPolicy: z.null(),
    answerKey: AnswerKeyAuthoringSchema,
  })
  .strict();

export const ListeningActivitySchema = z
  .object({
    ...ActivityBaseFields,
    type: z.literal("listening"),
    configuration: ListeningConfigSchema,
    transcriptPolicy: TranscriptPolicySchema,
  })
  .strict()
  .superRefine((activity, ctx) => {
    const hasAudio = activity.assets.some((a) => a.purpose === "audio");
    if (!hasAudio) {
      ctx.addIssue({
        code: "custom",
        message: "listening activities require at least one audio asset",
        path: ["assets"],
      });
    }
  });

export const WritingActivitySchema = z
  .object({
    ...ActivityBaseFields,
    type: z.literal("writing"),
    configuration: WritingConfigSchema,
    transcriptPolicy: z.null(),
    rubric: RubricAuthoringSchema,
  })
  .strict();

export const FormativeCheckActivitySchema = z
  .object({
    ...ActivityBaseFields,
    type: z.literal("formative_check"),
    configuration: FormativeCheckConfigSchema,
    transcriptPolicy: z.null(),
  })
  .strict();

export const ActivityAuthoringSchema = z.discriminatedUnion("type", [
  ExplanationActivitySchema,
  SelectionActivitySchema,
  MatchingActivitySchema,
  OrderingActivitySchema,
  ClozeActivitySchema,
  TypedResponseActivitySchema,
  ListeningActivitySchema,
  WritingActivitySchema,
  FormativeCheckActivitySchema,
]);
export type ActivityAuthoring = z.infer<typeof ActivityAuthoringSchema>;

export const LessonActivityLinkSchema = z
  .object({
    ordinal: OrdinalSchema,
    activity: ActivityAuthoringSchema,
  })
  .strict();

/** Re-export for callers that only need the closed activity-type enum. */
export { ActivityTypeSchema };
