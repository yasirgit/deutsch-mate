import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importX from "eslint-plugin-import-x";
import globals from "globals";
import tseslint from "typescript-eslint";

import workspaceMetadata from "./workspace-metadata.cjs";

const {
  GENERIC_FORBIDDEN_PACKAGE_PREFIXES,
  findRepoRoot,
  loadWorkspaces,
  tierImportVerdict,
  forbiddenPackagePrefixesForTier,
} = workspaceMetadata;

/** @typedef {import("./workspace-metadata.cjs").WorkspaceTier} WorkspaceTier */

/**
 * Files where devDependencies may be imported. Everywhere else an import must
 * be a declared production dependency (`docs/CODING_STANDARDS.md` §2, §16).
 */
const DEV_DEPENDENCY_FILE_GLOBS = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.smoke.ts",
  "**/vitest.config.*",
  "**/vitest.*.config.*",
  "**/*.config.mjs",
  "**/*.config.js",
  "**/*.config.ts",
  "**/eslint.config.mjs",
  "**/.dependency-cruiser.cjs",
];

const ALL_SOURCE_FILE_GLOBS = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];

/**
 * Expands an npm package name (or `@scope` prefix) into
 * `no-restricted-imports` glob patterns covering the package and its
 * subpaths without matching unrelated packages (`pg` must not match
 * `pg-mem`, `react` must not match `react-query`).
 *
 * @param {string} prefix
 * @returns {string[]}
 */
function importPatternsForPrefix(prefix) {
  if (prefix.startsWith("@") && !prefix.includes("/")) {
    return [`${prefix}/*`];
  }
  return [prefix, `${prefix}/*`];
}

/**
 * `no-restricted-imports` pattern groups shared by every tier.
 *
 * @returns {{ group: string[], message: string }[]}
 */
function genericRestrictedImportGroups() {
  return [
    {
      group: GENERIC_FORBIDDEN_PACKAGE_PREFIXES.flatMap(importPatternsForPrefix),
      message:
        "Generic common/utils dumping-ground packages are forbidden (docs/CODING_STANDARDS.md §5). They must not exist.",
    },
  ];
}

/**
 * Shared flat ESLint configuration for every Deutsch Mate workspace.
 *
 * Ignore patterns resolve relative to the consuming workspace's own
 * eslint.config.mjs, so build artifacts stay excluded per workspace.
 */
const baseConfig = tseslint.config(
  {
    ignores: ["dist/**", ".next/**", ".turbo/**", "coverage/**", "next-env.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },
  {
    // CommonJS modules (boundary tooling shared with dependency-cruiser's
    // CJS config loader) use require() by design.
    files: ["**/*.cjs", "**/*.cts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // Dependency hygiene applies everywhere, whichever tier a workspace is
    // in: imports must be declared in the importing workspace's own
    // package.json (no undeclared/transitive imports), relative imports must
    // not reach into sibling workspaces, and generic dumping-ground packages
    // are banned outright (DM-003; docs/CODING_STANDARDS.md §2, §5, §16).
    files: ALL_SOURCE_FILE_GLOBS,
    plugins: { "import-x": importX },
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver()],
    },
    rules: {
      "import-x/no-extraneous-dependencies": [
        "error",
        {
          devDependencies: DEV_DEPENDENCY_FILE_GLOBS,
          optionalDependencies: false,
          bundledDependencies: false,
          includeTypes: true,
        },
      ],
      "import-x/no-relative-packages": "error",
      "no-restricted-imports": ["error", { patterns: genericRestrictedImportGroups() }],
    },
  },
  prettierConfig,
);

export default baseConfig;

/**
 * Builds the full flat ESLint config for a workspace of the given tier:
 * the base config plus tier-scoped forbidden-import rules derived from the
 * `dm.tier` ownership metadata of every workspace in the repository.
 *
 * @param {WorkspaceTier} tier
 * @param {{ rootDir?: string }} [options] `rootDir` overrides repo-root
 *   discovery (used by the boundary regression tests against fixtures).
 * @returns {ReturnType<typeof tseslint.config>}
 */
export function configForTier(tier, options = {}) {
  const repoRootDir = options.rootDir ?? findRepoRoot(process.cwd());
  const workspaces = loadWorkspaces(repoRootDir);

  const patternGroups = genericRestrictedImportGroups();

  const forbiddenPrefixes = forbiddenPackagePrefixesForTier(tier);
  if (forbiddenPrefixes.length > 0) {
    patternGroups.push({
      group: forbiddenPrefixes.flatMap(importPatternsForPrefix),
      message:
        `Packages of tier "${tier}" must not import these framework/provider/server-only ` +
        "packages (docs/CODING_STANDARDS.md §5; DM-003).",
    });
  }

  const forbiddenWorkspaceNames = workspaces
    .filter((workspace) => tierImportVerdict(tier, workspace) === "forbidden")
    .map((workspace) => workspace.name);
  if (forbiddenWorkspaceNames.length > 0) {
    patternGroups.push({
      group: forbiddenWorkspaceNames.flatMap(importPatternsForPrefix),
      message:
        `Workspaces of tier "${tier}" must not import these workspaces ` +
        "(tier import matrix, docs/CODING_STANDARDS.md §5; DM-003).",
    });
  }

  return tseslint.config(...baseConfig, {
    // Tier import bans apply to product source only. Tool-config and test
    // files may import `@deutsch-mate/config` (eslint/prettier) and other
    // shared packages that are not client-safe — the same allowlist used by
    // `import-x/no-extraneous-dependencies` for devDependencies (DM-003/012).
    files: ALL_SOURCE_FILE_GLOBS,
    ignores: DEV_DEPENDENCY_FILE_GLOBS,
    rules: {
      "no-restricted-imports": ["error", { patterns: patternGroups }],
    },
  });
}

/**
 * Entry point for workspace `eslint.config.mjs` files: reads the calling
 * workspace's `dm.tier` from its own package.json, so the tier is declared
 * once in ownership metadata and never duplicated in lint config.
 *
 * @param {string} importMetaUrl `import.meta.url` of the workspace's eslint.config.mjs.
 * @returns {ReturnType<typeof tseslint.config>}
 */
export function configForWorkspace(importMetaUrl) {
  const workspaceDir = path.dirname(fileURLToPath(importMetaUrl));
  const repoRootDir = findRepoRoot(workspaceDir);
  const manifestPath = path.join(workspaceDir, "package.json");
  const manifest = /** @type {{ name?: string }} */ (
    JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  );
  const workspace = loadWorkspaces(repoRootDir).find((entry) => entry.name === manifest.name);
  if (workspace === undefined) {
    throw new Error(
      `${manifestPath} is not a declared pnpm workspace; cannot derive its boundary tier`,
    );
  }
  return configForTier(workspace.tier, { rootDir: repoRootDir });
}
