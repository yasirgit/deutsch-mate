import { describe, expect, it } from "vitest";

import {
  ActivityAuthoringSchema,
  ActivityTypeSchema,
  AnswerSpecSchema,
  CefrLevelSchema,
  ContentAuthoringDocumentSchema,
  FORBIDDEN_ACTIVITY_TYPES,
  FORBIDDEN_ANSWER_SPEC_KINDS,
  RichTextDocSchema,
  safeValidateContentDocument,
  validateContentDocument,
} from "./index.js";
import { paragraph } from "./rich-text.js";

const baseObjectives = [
  {
    objectiveKey: "obj.a1.m1.u1.greetings",
    objectiveVersion: 1,
    weight: "1.0",
  },
] as const;

describe("enums", () => {
  it("allows A1–B2 only", () => {
    expect(CefrLevelSchema.safeParse("B2").success).toBe(true);
    expect(CefrLevelSchema.safeParse("C1").success).toBe(false);
    expect(CefrLevelSchema.safeParse("C2").success).toBe(false);
  });

  it("covers all MVP activity types and excludes speaking/assessment", () => {
    expect([...ActivityTypeSchema.options]).toEqual([
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
    for (const forbidden of FORBIDDEN_ACTIVITY_TYPES) {
      expect(ActivityTypeSchema.safeParse(forbidden).success).toBe(false);
    }
  });
});

describe("rich text", () => {
  it("accepts a closed AST and rejects HTML nodes", () => {
    expect(RichTextDocSchema.safeParse(paragraph("Guten Tag")).success).toBe(true);
    expect(
      RichTextDocSchema.safeParse({
        type: "doc",
        version: 1,
        blocks: [{ type: "html", html: "<p>x</p>" }],
      }).success,
    ).toBe(false);
  });
});

describe("answer specs", () => {
  it("accepts declarative kinds and rejects executable expressions", () => {
    expect(AnswerSpecSchema.safeParse({ kind: "exact", value: "Guten Tag" }).success).toBe(true);
    for (const kind of FORBIDDEN_ANSWER_SPEC_KINDS) {
      expect(AnswerSpecSchema.safeParse({ kind, expression: "1+1" }).success).toBe(false);
    }
  });
});

describe("validateContentDocument", () => {
  it("rejects unknown fields", () => {
    const result = safeValidateContentDocument({
      schemaVersion: 1,
      kind: "cefr_descriptor",
      descriptorKey: "cefr.a1.spoken.interaction.greetings",
      version: 1,
      level: "A1",
      skill: "vocabulary",
      sourceName: "CEFR",
      sourceEdition: "2020",
      descriptorText: "Can greet.",
      unexpected: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects speaking activity types before schema parse completes", () => {
    expect(() =>
      validateContentDocument({
        schemaVersion: 1,
        kind: "unit",
        type: "speaking",
      }),
    ).toThrow(/forbidden activity type/);
  });

  it("rejects executable answer kinds in nested payloads", () => {
    expect(() =>
      validateContentDocument({
        schemaVersion: 1,
        kind: "objective",
        objectiveKey: "obj.a1.m1.u1.greetings",
        version: 1,
        level: "A1",
        skill: "vocabulary",
        title: "x",
        description: "y",
        descriptors: [
          {
            descriptorKey: "cefr.a1.spoken.interaction.greetings",
            descriptorVersion: 1,
            kind: "expression",
          },
        ],
      }),
    ).toThrow(/forbidden answer expression/);
  });

  it("parses a minimal valid descriptor", () => {
    const { document } = validateContentDocument({
      schemaVersion: 1,
      kind: "cefr_descriptor",
      descriptorKey: "cefr.a1.spoken.interaction.greetings",
      version: 1,
      level: "A1",
      skill: "vocabulary",
      sourceName: "CEFR",
      sourceEdition: "2020",
      descriptorText: "Can greet.",
    });
    expect(document.kind).toBe("cefr_descriptor");
  });
});

describe("activities", () => {
  it("requires transcriptPolicy and audio for listening", () => {
    const withoutAudio = ActivityAuthoringSchema.safeParse({
      schemaVersion: 1,
      activityKey: "act.a1.m1.u1.listening",
      version: 1,
      type: "listening",
      level: "A1",
      prompt: paragraph("Listen"),
      maxScore: "1.000",
      required: true,
      objectives: baseObjectives,
      assets: [],
      configuration: {
        items: [
          {
            type: "typed_response",
            prompt: paragraph("What did you hear?"),
            configuration: { maxLength: 40 },
            answerKey: {
              version: 1,
              scoringAlgorithmVersion: "typed.exact.v1",
              answerSpec: { kind: "exact", value: "Hallo" },
              maxScore: "1.000",
            },
          },
        ],
      },
      transcriptPolicy: "always",
    });
    expect(withoutAudio.success).toBe(false);
  });

  it("forbids answerKey on writing via strict object shape", () => {
    const result = ActivityAuthoringSchema.safeParse({
      schemaVersion: 1,
      activityKey: "act.a1.m1.u1.writing",
      version: 1,
      type: "writing",
      level: "A1",
      prompt: paragraph("Write"),
      maxScore: "4.000",
      required: true,
      objectives: baseObjectives,
      assets: [],
      configuration: { minChars: 10, maxChars: 100 },
      transcriptPolicy: null,
      answerKey: {
        version: 1,
        scoringAlgorithmVersion: "typed.exact.v1",
        answerSpec: { kind: "exact", value: "nope" },
        maxScore: "1.000",
      },
      rubric: {
        rubricKey: "rubric.a1.writing.greetings",
        version: 1,
        dimensions: [
          {
            code: "task_completion",
            title: "Task",
            description: paragraph("d"),
            maxPoints: "1.000",
          },
          {
            code: "grammar",
            title: "Grammar",
            description: paragraph("d"),
            maxPoints: "1.000",
          },
          {
            code: "vocabulary",
            title: "Vocabulary",
            description: paragraph("d"),
            maxPoints: "1.000",
          },
          {
            code: "clarity",
            title: "Clarity",
            description: paragraph("d"),
            maxPoints: "1.000",
          },
        ],
        scoringRule: { kind: "sum_dimensions", passThreshold: "2.000" },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("ContentAuthoringDocumentSchema", () => {
  it("discriminates document kinds", () => {
    expect(ContentAuthoringDocumentSchema.options.map((o) => o.shape.kind.value)).toEqual([
      "cefr_descriptor",
      "objective",
      "module",
      "unit",
    ]);
  });
});
