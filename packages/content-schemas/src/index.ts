export {
  AUTHORING_SCHEMA_VERSION,
  AccessTierSchema,
  ActivityTypeSchema,
  AssetPurposeSchema,
  CefrLevelSchema,
  ContentVersionSchema,
  EstimatedMinutesSchema,
  FORBIDDEN_ACTIVITY_TYPES,
  ObjectiveWeightSchema,
  OrdinalSchema,
  RubricDimensionCodeSchema,
  ScoreDecimalSchema,
  Sha256HexSchema,
  SkillCodeSchema,
  TranscriptPolicySchema,
  type AccessTier,
  type ActivityType,
  type AssetPurpose,
  type CefrLevel,
  type ContentVersion,
  type ObjectiveWeight,
  type RubricDimensionCode,
  type ScoreDecimal,
  type SkillCode,
  type TranscriptPolicy,
} from "./enums.js";

export {
  ActivityKeySchema,
  AssetKeySchema,
  BlankIdSchema,
  DescriptorKeySchema,
  LessonKeySchema,
  ModuleKeySchema,
  ObjectiveKeySchema,
  OptionIdSchema,
  ReleaseKeySchema,
  RubricKeySchema,
  ScoringAlgorithmVersionSchema,
  UnitKeySchema,
} from "./keys.js";

export {
  FORBIDDEN_RICH_TEXT_NODE_TYPES,
  RichTextBlockSchema,
  RichTextDocSchema,
  RichTextInlineSchema,
  paragraph,
  type RichTextBlock,
  type RichTextDoc,
  type RichTextInline,
  type RichTextMark,
} from "./rich-text.js";

export {
  AnswerKeyAuthoringSchema,
  AnswerSpecSchema,
  CaseFoldedAnswerSpecSchema,
  ClozeAnswerSpecSchema,
  ExactAnswerSpecSchema,
  FORBIDDEN_ANSWER_SPEC_KINDS,
  MatchingAnswerSpecSchema,
  NormalizedAnswerSpecSchema,
  OrderedAnswerSpecSchema,
  SetAnswerSpecSchema,
  WeightedAlternativesAnswerSpecSchema,
  type AnswerKeyAuthoring,
  type AnswerSpec,
} from "./answers.js";

export {
  RubricAuthoringSchema,
  RubricDimensionSchema,
  RubricScoringRuleSchema,
  type RubricAuthoring,
} from "./rubrics.js";

export { ActivityAssetAuthoringSchema, type ActivityAssetAuthoring } from "./assets.js";

export {
  ActivityAuthoringSchema,
  ClozeActivitySchema,
  ExplanationActivitySchema,
  FormativeCheckActivitySchema,
  LessonActivityLinkSchema,
  ListeningActivitySchema,
  MatchingActivitySchema,
  OrderingActivitySchema,
  SelectionActivitySchema,
  TypedResponseActivitySchema,
  WritingActivitySchema,
  type ActivityAuthoring,
} from "./activities.js";

export {
  CefrDescriptorAuthoringSchema,
  ContentAuthoringDocumentSchema,
  LessonAuthoringSchema,
  LessonCompletionRuleSchema,
  ModuleAuthoringSchema,
  ObjectiveAuthoringSchema,
  UnitAuthoringSchema,
  UnitObjectiveLinkSchema,
  UnitPrerequisiteSchema,
  type CefrDescriptorAuthoring,
  type ContentAuthoringDocument,
  type LessonAuthoring,
  type ModuleAuthoring,
  type ObjectiveAuthoring,
  type UnitAuthoring,
} from "./curriculum.js";

export {
  ContentValidationError,
  safeValidateContentDocument,
  validateContentDocument,
} from "./validate.js";

export { JSON_SCHEMA_EXPORTS, exportJsonSchemas } from "./json-schema.js";
