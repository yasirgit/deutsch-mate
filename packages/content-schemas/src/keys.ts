import { z } from "zod";

/**
 * Stable content keys survive revisions; versions are immutable
 * (`docs/Database.md` §4.4). Keys are lowercase dotted identifiers.
 */
const KEY_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/;

function keySchema(max: number, label: string) {
  return z
    .string()
    .min(3)
    .max(max)
    .regex(KEY_PATTERN, `${label} must be a lowercase dotted identifier`);
}

export const ModuleKeySchema = keySchema(80, "moduleKey");
export const UnitKeySchema = keySchema(80, "unitKey");
export const LessonKeySchema = keySchema(80, "lessonKey");
export const ActivityKeySchema = keySchema(100, "activityKey");
export const ObjectiveKeySchema = keySchema(100, "objectiveKey");
export const DescriptorKeySchema = keySchema(100, "descriptorKey");
export const RubricKeySchema = keySchema(100, "rubricKey");
export const ReleaseKeySchema = keySchema(80, "releaseKey");
export const AssetKeySchema = keySchema(100, "assetKey");
export const OptionIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, "option id must be snake_case");
export const BlankIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, "blank id must be snake_case");
export const ScoringAlgorithmVersionSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9._-]*$/, "scoring algorithm version id");
