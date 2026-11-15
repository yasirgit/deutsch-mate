import { z } from "zod";

/** Authoring schema format version for top-level documents. */
export const AUTHORING_SCHEMA_VERSION = 1 as const;

/** CEFR levels in MVP scope (ADR-001). C1/C2 are intentionally absent. */
export const CefrLevelSchema = z.enum(["A1", "A2", "B1", "B2"]);
export type CefrLevel = z.infer<typeof CefrLevelSchema>;

/** Skills tracked in `content.skill_code` (docs/Database.md). Speaking is post-MVP. */
export const SkillCodeSchema = z.enum(["reading", "listening", "writing", "vocabulary", "grammar"]);
export type SkillCode = z.infer<typeof SkillCodeSchema>;

/** MVP activity types in `content.activity_type`. Speaking/assessment excluded. */
export const ActivityTypeSchema = z.enum([
  "explanation",
  "selection",
  "matching",
  "ordering",
  "cloze",
  "typed_response",
  "listening",
  "writing",
  "formative_check",
]);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

/** Forbidden post-MVP / assessment constructs that must never author as activities. */
export const FORBIDDEN_ACTIVITY_TYPES = [
  "speaking",
  "pronunciation",
  "placement",
  "readiness",
  "assessment",
  "exam",
  "oral",
] as const;

export const TranscriptPolicySchema = z.enum([
  "always",
  "after_first_submission",
  "after_completion",
  "never",
]);
export type TranscriptPolicy = z.infer<typeof TranscriptPolicySchema>;

export const AccessTierSchema = z.enum(["free", "premium"]);
export type AccessTier = z.infer<typeof AccessTierSchema>;

export const AssetPurposeSchema = z.enum(["audio", "image", "attachment"]);
export type AssetPurpose = z.infer<typeof AssetPurposeSchema>;

export const RubricDimensionCodeSchema = z.enum([
  "task_completion",
  "grammar",
  "vocabulary",
  "clarity",
]);
export type RubricDimensionCode = z.infer<typeof RubricDimensionCodeSchema>;

/** Positive integer content version (`CK(version>0)`). */
export const ContentVersionSchema = z.number().int().positive();
export type ContentVersion = z.infer<typeof ContentVersionSchema>;

/** Positive ordinal (`CK(ordinal>0)`). */
export const OrdinalSchema = z.number().int().positive();

/** Estimated minutes (`CK(BETWEEN 1 AND 180)`). */
export const EstimatedMinutesSchema = z.number().int().min(1).max(180);

/**
 * Decimal-as-string for scores (`numeric(8,3)`). Non-negative with up to three
 * fractional digits. Never floating point at the authoring boundary.
 */
export const ScoreDecimalSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,4})(?:\.[0-9]{1,3})?$/, "expected non-negative decimal string");
export type ScoreDecimal = z.infer<typeof ScoreDecimalSchema>;

/** Objective weight (`numeric(5,4)`, exclusive of 0, inclusive of 1). */
export const ObjectiveWeightSchema = z
  .string()
  .regex(/^0\.[0-9]{1,4}$|^1(?:\.0{1,4})?$/, "expected weight in (0,1] as decimal string");
export type ObjectiveWeight = z.infer<typeof ObjectiveWeightSchema>;

/** Lowercase SHA-256 hex for asset checksums. */
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "expected lowercase sha256 hex");
