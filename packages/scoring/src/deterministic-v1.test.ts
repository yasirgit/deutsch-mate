import { describe, expect, it } from "vitest";

import { scoreAnswerSpec } from "./deterministic-v1.js";
import { parseLearnerResponse } from "./parse-response.js";
import type { AnswerSpec } from "./types.js";

describe("deterministic.v1 AnswerSpec scoring", () => {
  it("scores exact matches and rejects empty/wrong", () => {
    const spec: AnswerSpec = { kind: "exact", value: "Guten Tag" };
    expect(scoreAnswerSpec(spec, { kind: "text", text: "Guten Tag" }, 1).passed).toBe(true);
    expect(scoreAnswerSpec(spec, { kind: "text", text: "guten tag" }, 1).passed).toBe(false);
    expect(scoreAnswerSpec(spec, { kind: "empty" }, 1).score).toBe(0);
    expect(scoreAnswerSpec(spec, { kind: "text", text: "" }, 1).passed).toBe(false);
  });

  it("scores case_folded ignoring case but not punctuation drift", () => {
    const spec: AnswerSpec = { kind: "case_folded", value: "Hallo" };
    expect(scoreAnswerSpec(spec, { kind: "text", text: "HALLO" }, 1).passed).toBe(true);
    expect(scoreAnswerSpec(spec, { kind: "text", text: " hallo " }, 1).passed).toBe(true);
    expect(scoreAnswerSpec(spec, { kind: "text", text: "Hallo!" }, 1).passed).toBe(false);
  });

  it("scores normalized with punctuation stripping", () => {
    const spec: AnswerSpec = { kind: "normalized", value: "Guten Tag" };
    expect(scoreAnswerSpec(spec, { kind: "text", text: "guten  tag!" }, 1).passed).toBe(true);
    expect(scoreAnswerSpec(spec, { kind: "text", text: "Guten-Tag" }, 1).passed).toBe(true);
    expect(scoreAnswerSpec(spec, { kind: "text", text: "Guten Abend" }, 1).passed).toBe(false);
  });

  it("scores set as order-independent option ids", () => {
    const spec: AnswerSpec = { kind: "set", values: ["opt_a", "opt_b"] };
    expect(
      scoreAnswerSpec(spec, { kind: "selected", selected: ["opt_b", "opt_a"] }, 2).passed,
    ).toBe(true);
    expect(scoreAnswerSpec(spec, { kind: "selected", selected: ["opt_a"] }, 2).passed).toBe(false);
    expect(scoreAnswerSpec(spec, { kind: "selected", selected: [] }, 2).score).toBe(0);
    expect(scoreAnswerSpec(spec, { kind: "order", order: ["opt_a", "opt_b"] }, 2).passed).toBe(
      false,
    );
  });

  it("scores ordered requiring exact sequence", () => {
    const spec: AnswerSpec = { kind: "ordered", order: ["a", "b", "c"] };
    expect(scoreAnswerSpec(spec, { kind: "order", order: ["a", "b", "c"] }, 1).passed).toBe(true);
    expect(scoreAnswerSpec(spec, { kind: "order", order: ["c", "b", "a"] }, 1).passed).toBe(false);
    expect(scoreAnswerSpec(spec, { kind: "selected", selected: ["a", "b", "c"] }, 1).passed).toBe(
      false,
    );
  });

  it("scores matching as unordered pair equality", () => {
    const spec: AnswerSpec = {
      kind: "matching",
      pairs: [
        { leftId: "l1", rightId: "r1" },
        { leftId: "l2", rightId: "r2" },
      ],
    };
    expect(
      scoreAnswerSpec(
        spec,
        {
          kind: "pairs",
          pairs: [
            { leftId: "l2", rightId: "r2" },
            { leftId: "l1", rightId: "r1" },
          ],
        },
        1,
      ).passed,
    ).toBe(true);
    expect(
      scoreAnswerSpec(
        spec,
        {
          kind: "pairs",
          pairs: [
            { leftId: "l1", rightId: "r2" },
            { leftId: "l2", rightId: "r1" },
          ],
        },
        1,
      ).passed,
    ).toBe(false);
  });

  it("scores weighted_alternatives with best matching weight", () => {
    const spec: AnswerSpec = {
      kind: "weighted_alternatives",
      alternatives: [
        { value: "Berlin", weight: "1.0", match: "case_folded" },
        { value: "berlin city", weight: "0.5", match: "normalized" },
      ],
    };
    const full = scoreAnswerSpec(spec, { kind: "text", text: "BERLIN" }, 2);
    expect(full.passed).toBe(true);
    expect(full.score).toBe(2);

    const partial = scoreAnswerSpec(spec, { kind: "text", text: "Berlin-city!" }, 2);
    expect(partial.passed).toBe(false);
    expect(partial.score).toBe(1);
    expect(partial.details.scoreRatio).toBe(0.5);

    expect(scoreAnswerSpec(spec, { kind: "text", text: "Munich" }, 2).score).toBe(0);
  });

  it("scores cloze with partial credit per blank", () => {
    const spec: AnswerSpec = {
      kind: "cloze",
      blanks: [
        { blankId: "b1", accept: { kind: "exact", value: "bin" } },
        { blankId: "b2", accept: { kind: "case_folded", value: "Student" } },
        {
          blankId: "b3",
          accept: {
            kind: "weighted_alternatives",
            alternatives: [{ value: "aus", weight: "1.0", match: "exact" }],
          },
        },
      ],
    };

    const full = scoreAnswerSpec(
      spec,
      { kind: "blanks", blanks: { b1: "bin", b2: "STUDENT", b3: "aus" } },
      3,
    );
    expect(full.passed).toBe(true);
    expect(full.score).toBe(3);

    const partial = scoreAnswerSpec(
      spec,
      { kind: "blanks", blanks: { b1: "bin", b2: "Lehrer", b3: "aus" } },
      3,
    );
    expect(partial.passed).toBe(false);
    expect(partial.details.scoreRatio).toBeCloseTo(2 / 3, 3);
    expect(partial.details.blankResults?.["b2"]?.matched).toBe(false);

    const empty = scoreAnswerSpec(spec, { kind: "blanks", blanks: {} }, 3);
    expect(empty.score).toBe(0);
  });
});

describe("parseLearnerResponse", () => {
  it("maps choice/structured OpenAPI shapes", () => {
    expect(
      parseLearnerResponse({
        responseKind: "choice",
        response: { selected: ["opt_a"] },
      }),
    ).toEqual({ kind: "selected", selected: ["opt_a"] });

    expect(
      parseLearnerResponse({
        responseKind: "text",
        textContent: "Hallo",
      }),
    ).toEqual({ kind: "text", text: "Hallo" });

    expect(
      parseLearnerResponse({
        responseKind: "structured",
        response: { blanks: { b1: "bin" } },
      }),
    ).toEqual({ kind: "blanks", blanks: { b1: "bin" } });
  });
});
