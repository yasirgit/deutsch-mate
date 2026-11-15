/**
 * Prohibited certification / certificate copy scan (FR-052, ADR-015, MVP G1).
 * Case-insensitive phrase match over titles, summaries, explanations, and
 * other learner-visible strings in a release package.
 */

export const BANNED_CERTIFICATION_PHRASES = [
  "official cefr certificate",
  "official cefr certification",
  "cefr certificate",
  "cefr certification",
  "accredited certificate",
  "accredited certification",
  "official certificate",
  "official certification",
  "named exam",
  "goethe-zertifikat",
  "testdaf",
  "telc certificate",
] as const;

export interface ProhibitedCopyHit {
  readonly path: string;
  readonly phrase: string;
  readonly excerpt: string;
}

function collectStrings(value: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof value === "string") {
    if (value.length > 0) {
      out.push({ path, text: value });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectStrings(item, `${path}[${index}]`, out);
    });
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      collectStrings(child, path === "" ? key : `${path}.${key}`, out);
    }
  }
}

/**
 * Scan arbitrary JSON-like content for banned certification phrases.
 */
export function findProhibitedCertificationCopy(value: unknown): readonly ProhibitedCopyHit[] {
  const strings: { path: string; text: string }[] = [];
  collectStrings(value, "", strings);
  const hits: ProhibitedCopyHit[] = [];
  for (const { path, text } of strings) {
    const lower = text.toLowerCase();
    for (const phrase of BANNED_CERTIFICATION_PHRASES) {
      if (lower.includes(phrase)) {
        hits.push({
          path: path === "" ? "(root)" : path,
          phrase,
          excerpt: text.length > 120 ? `${text.slice(0, 117)}...` : text,
        });
      }
    }
  }
  return hits;
}
