import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDependencyCruiserConfig } from "@deutsch-mate/config/dependency-cruiser";
import { cruise } from "dependency-cruiser";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * Regression tests for the DM-003 boundary tooling itself: if the shared
 * ESLint tier config or the dependency-cruiser policy stops flagging
 * forbidden imports, these tests fail (`docs/CODING_STANDARDS.md` §5, §17.8).
 */

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

async function lintFixture(
  tier: "domain" | "client",
  code: string,
): Promise<readonly (string | null)[]> {
  // Each fixture workspace has a real eslint.config.mjs that opts into its
  // tier via `configForTier`, so this exercises the exact consumption path
  // the production workspaces use.
  const fixtureDir = path.join(fixturesDir, "eslint", tier);
  const eslint = new ESLint({ cwd: fixtureDir });
  const results = await eslint.lintText(code, {
    filePath: path.join(fixtureDir, "src", "sample.ts"),
  });
  return (results[0]?.messages ?? []).map((message) => message.ruleId);
}

describe("shared ESLint boundary config", () => {
  it("flags a domain import of a framework/provider adapter", async () => {
    const ruleIds = await lintFixture("domain", 'import "pg";\nexport const value = 1;\n');

    expect(ruleIds).toContain("no-restricted-imports");
  });

  it("flags an undeclared dependency import", async () => {
    // eslint is resolvable from the fixture but not declared in the fixture
    // package.json, so it must be reported as extraneous.
    const ruleIds = await lintFixture("domain", 'import "eslint";\nexport const value = 1;\n');

    expect(ruleIds).toContain("import-x/no-extraneous-dependencies");
  });

  it("flags a generic dumping-ground package import in every tier", async () => {
    const ruleIds = await lintFixture(
      "domain",
      'import "@deutsch-mate/utils";\nexport const value = 1;\n',
    );

    expect(ruleIds).toContain("no-restricted-imports");
  });

  it("flags a client import of the API app and of a server-only package", async () => {
    const ruleIds = await lintFixture(
      "client",
      'import "@deutsch-mate/api";\nimport "ioredis";\nexport const value = 1;\n',
    );

    expect(ruleIds.filter((ruleId) => ruleId === "no-restricted-imports")).toHaveLength(2);
  });
});

describe("dependency-cruiser boundary policy", () => {
  it("flags cycles, app-to-app imports, client-to-server imports, and domain adapters", async () => {
    const fixtureRepoDir = path.join(fixturesDir, "boundary-repo");
    const config = createDependencyCruiserConfig(fixtureRepoDir);

    const cruiseResult = await cruise(["apps", "packages"], {
      ...config.options,
      ruleSet: { forbidden: config.forbidden },
      validate: true,
    });

    expect(typeof cruiseResult.output).not.toBe("string");
    if (typeof cruiseResult.output === "string") {
      throw new Error("expected a structured cruise result");
    }
    const violatedRules = cruiseResult.output.summary.violations.map(
      (violation) => violation.rule.name,
    );

    expect(violatedRules).toContain("no-circular");
    // fixture-web (client app) imports fixture-api (server app).
    expect(violatedRules).toContain("workspace-boundary--apps-web");
    // fixture-web imports the server-only package ioredis.
    expect(violatedRules).toContain("tier-packages--apps-web");
    // fixture-domain imports the database adapter pg.
    expect(violatedRules).toContain("tier-packages--packages-domain");
    expect(cruiseResult.output.summary.error).toBeGreaterThan(0);
  });
});
