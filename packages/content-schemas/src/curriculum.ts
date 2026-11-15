import { z } from "zod";

import { LessonActivityLinkSchema } from "./activities.js";
import {
  AccessTierSchema,
  AUTHORING_SCHEMA_VERSION,
  CefrLevelSchema,
  EstimatedMinutesSchema,
  OrdinalSchema,
  SkillCodeSchema,
} from "./enums.js";
import {
  DescriptorKeySchema,
  LessonKeySchema,
  ModuleKeySchema,
  ObjectiveKeySchema,
  UnitKeySchema,
} from "./keys.js";
import { RichTextDocSchema } from "./rich-text.js";

/**
 * Curriculum authoring documents: CEFR descriptors, objectives, modules,
 * lessons, and units. Stable keys + immutable positive integer versions
 * (`docs/Database.md` §4.4; FR-020).
 */

export const CefrDescriptorAuthoringSchema = z
  .object({
    schemaVersion: z.literal(AUTHORING_SCHEMA_VERSION),
    kind: z.literal("cefr_descriptor"),
    descriptorKey: DescriptorKeySchema,
    version: z.number().int().positive(),
    level: CefrLevelSchema,
    skill: SkillCodeSchema,
    sourceName: z.string().min(1).max(120),
    sourceEdition: z.string().min(1).max(80),
    descriptorText: z.string().min(1).max(2000),
  })
  .strict();
export type CefrDescriptorAuthoring = z.infer<typeof CefrDescriptorAuthoringSchema>;

export const ObjectiveAuthoringSchema = z
  .object({
    schemaVersion: z.literal(AUTHORING_SCHEMA_VERSION),
    kind: z.literal("objective"),
    objectiveKey: ObjectiveKeySchema,
    version: z.number().int().positive(),
    level: CefrLevelSchema,
    skill: SkillCodeSchema,
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(2000),
    descriptors: z
      .array(
        z
          .object({
            descriptorKey: DescriptorKeySchema,
            descriptorVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
export type ObjectiveAuthoring = z.infer<typeof ObjectiveAuthoringSchema>;

export const LessonCompletionRuleSchema = z
  .object({
    kind: z.literal("required_activities"),
    /** All activities with required=true must be completed. */
    requireAllRequired: z.literal(true),
  })
  .strict();

export const LessonAuthoringSchema = z
  .object({
    lessonKey: LessonKeySchema,
    version: z.number().int().positive(),
    title: z.string().min(1).max(160),
    explanation: RichTextDocSchema,
    examples: RichTextDocSchema,
    completionRule: LessonCompletionRuleSchema,
    estimatedMinutes: EstimatedMinutesSchema,
    activities: z.array(LessonActivityLinkSchema).min(1).max(40),
  })
  .strict();
export type LessonAuthoring = z.infer<typeof LessonAuthoringSchema>;

export const UnitObjectiveLinkSchema = z
  .object({
    objectiveKey: ObjectiveKeySchema,
    objectiveVersion: z.number().int().positive(),
    isPrimary: z.boolean(),
  })
  .strict();

export const UnitPrerequisiteSchema = z
  .object({
    unitKey: UnitKeySchema,
    unitVersion: z.number().int().positive(),
  })
  .strict();

export const UnitAuthoringSchema = z
  .object({
    schemaVersion: z.literal(AUTHORING_SCHEMA_VERSION),
    kind: z.literal("unit"),
    unitKey: UnitKeySchema,
    version: z.number().int().positive(),
    moduleKey: ModuleKeySchema,
    level: CefrLevelSchema,
    title: z.string().min(1).max(160),
    summary: z.string().min(1).max(2000),
    ordinal: OrdinalSchema,
    estimatedMinutes: EstimatedMinutesSchema,
    accessTier: AccessTierSchema,
    prerequisites: z.array(UnitPrerequisiteSchema).max(8),
    objectives: z.array(UnitObjectiveLinkSchema).min(1).max(12),
    lessons: z
      .array(
        z
          .object({
            ordinal: OrdinalSchema,
            required: z.boolean(),
            lesson: LessonAuthoringSchema,
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict()
  .superRefine((unit, ctx) => {
    for (const [index, prereq] of unit.prerequisites.entries()) {
      if (prereq.unitKey === unit.unitKey) {
        ctx.addIssue({
          code: "custom",
          message: "unit cannot list itself as a prerequisite",
          path: ["prerequisites", index, "unitKey"],
        });
      }
    }
    const ordinals = unit.lessons.map((l) => l.ordinal);
    if (new Set(ordinals).size !== ordinals.length) {
      ctx.addIssue({
        code: "custom",
        message: "lesson ordinals must be unique within a unit",
        path: ["lessons"],
      });
    }
  });
export type UnitAuthoring = z.infer<typeof UnitAuthoringSchema>;

export const ModuleAuthoringSchema = z
  .object({
    schemaVersion: z.literal(AUTHORING_SCHEMA_VERSION),
    kind: z.literal("module"),
    moduleKey: ModuleKeySchema,
    version: z.number().int().positive(),
    level: CefrLevelSchema,
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(2000),
    ordinal: OrdinalSchema,
    /** Stable unit key+version pins; full unit bodies live in unit documents. */
    units: z
      .array(
        z
          .object({
            ordinal: OrdinalSchema,
            unitKey: UnitKeySchema,
            unitVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict()
  .superRefine((mod, ctx) => {
    const ordinals = mod.units.map((u) => u.ordinal);
    if (new Set(ordinals).size !== ordinals.length) {
      ctx.addIssue({
        code: "custom",
        message: "unit ordinals must be unique within a module",
        path: ["units"],
      });
    }
  });
export type ModuleAuthoring = z.infer<typeof ModuleAuthoringSchema>;

export const ContentAuthoringDocumentSchema = z.discriminatedUnion("kind", [
  CefrDescriptorAuthoringSchema,
  ObjectiveAuthoringSchema,
  ModuleAuthoringSchema,
  UnitAuthoringSchema,
]);
export type ContentAuthoringDocument = z.infer<typeof ContentAuthoringDocumentSchema>;
