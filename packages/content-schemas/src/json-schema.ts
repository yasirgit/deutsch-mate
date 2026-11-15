import { z } from "zod";

import { AnswerSpecSchema, AnswerKeyAuthoringSchema } from "./answers.js";
import { ActivityAuthoringSchema } from "./activities.js";
import { ActivityAssetAuthoringSchema } from "./assets.js";
import {
  ContentAuthoringDocumentSchema,
  CefrDescriptorAuthoringSchema,
  LessonAuthoringSchema,
  ModuleAuthoringSchema,
  ObjectiveAuthoringSchema,
  UnitAuthoringSchema,
} from "./curriculum.js";
import { RichTextDocSchema } from "./rich-text.js";
import { RubricAuthoringSchema } from "./rubrics.js";

export const JSON_SCHEMA_EXPORTS = [
  { fileName: "authoring-document.schema.json", schema: ContentAuthoringDocumentSchema },
  { fileName: "cefr-descriptor.schema.json", schema: CefrDescriptorAuthoringSchema },
  { fileName: "objective.schema.json", schema: ObjectiveAuthoringSchema },
  { fileName: "module.schema.json", schema: ModuleAuthoringSchema },
  { fileName: "unit.schema.json", schema: UnitAuthoringSchema },
  { fileName: "lesson.schema.json", schema: LessonAuthoringSchema },
  { fileName: "activity.schema.json", schema: ActivityAuthoringSchema },
  { fileName: "rich-text.schema.json", schema: RichTextDocSchema },
  { fileName: "answer-spec.schema.json", schema: AnswerSpecSchema },
  { fileName: "answer-key.schema.json", schema: AnswerKeyAuthoringSchema },
  { fileName: "rubric.schema.json", schema: RubricAuthoringSchema },
  { fileName: "activity-asset.schema.json", schema: ActivityAssetAuthoringSchema },
] as const;

export function exportJsonSchemas(): ReadonlyArray<{
  readonly fileName: string;
  readonly schema: Record<string, unknown>;
}> {
  return JSON_SCHEMA_EXPORTS.map(({ fileName, schema }) => ({
    fileName,
    schema: z.toJSONSchema(schema, {
      target: "draft-2020-12",
      unrepresentable: "throw",
    }) as Record<string, unknown>,
  }));
}
