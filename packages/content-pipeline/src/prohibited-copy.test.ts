import { describe, expect, it } from "vitest";

import { findProhibitedCertificationCopy } from "./prohibited-copy.js";

describe("findProhibitedCertificationCopy", () => {
  it("flags banned certification phrases case-insensitively", () => {
    const hits = findProhibitedCertificationCopy({
      title: "Earn an Official CEFR Certificate today",
      summary: "Safe summary",
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.phrase.includes("cefr certificate"))).toBe(true);
  });

  it("allows CEFR-aligned estimate language", () => {
    const hits = findProhibitedCertificationCopy({
      title: "CEFR-aligned A1 greetings",
      summary: "Estimated evidence of progress — not a certificate of achievement from us claiming accreditation.",
    });
    // "certificate" alone is not banned; only listed phrases.
    expect(hits.filter((h) => h.phrase === "cefr certificate")).toHaveLength(0);
  });
});
