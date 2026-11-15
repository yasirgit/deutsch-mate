/**
 * Text normalization helpers for deterministic answer matching.
 */

/** NFC + trim + collapse internal whitespace. */
export function collapseWhitespace(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Case-fold using Unicode lowercasing (German-friendly for ß/SS via toLowerCase). */
export function caseFold(value: string): string {
  return collapseWhitespace(value).toLocaleLowerCase("de-DE");
}

/**
 * Stronger normalization: case-fold, strip/replace common punctuation, collapse space.
 * Distinct from `case_folded` (which preserves punctuation).
 */
export function normalizeAnswer(value: string): string {
  return caseFold(value)
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035'`]/g, "")
    .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB"]/g, "")
    .replace(/[.,!?;:…·•\-–—_/\\()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchText(
  actual: string,
  expected: string,
  mode: "exact" | "case_folded" | "normalized",
): boolean {
  switch (mode) {
    case "exact":
      return actual === expected;
    case "case_folded":
      return caseFold(actual) === caseFold(expected);
    case "normalized":
      return normalizeAnswer(actual) === normalizeAnswer(expected);
  }
}
