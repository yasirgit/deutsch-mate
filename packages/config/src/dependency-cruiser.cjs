"use strict";

/**
 * Dependency-graph policy factory for `pnpm boundaries:check` (DM-003;
 * `docs/CODING_STANDARDS.md` §5, §16-17).
 *
 * The root `.dependency-cruiser.cjs` calls {@link createDependencyCruiserConfig}
 * with the repository root; boundary regression tests call it with a fixture
 * root. All tier rules are derived from each workspace's `dm.tier` package
 * ownership metadata rather than hardcoded paths.
 */

const fs = require("node:fs");
const path = require("node:path");

const {
  GENERIC_FORBIDDEN_PACKAGE_PREFIXES,
  loadWorkspaces,
  tierImportVerdict,
  forbiddenPackagePrefixesForTier,
} = require("./workspace-metadata.cjs");

/** @typedef {import("./workspace-metadata.cjs").WorkspaceInfo} WorkspaceInfo */

/**
 * @typedef {object} ForbiddenRule
 * @property {string} name
 * @property {"error"} severity
 * @property {string} comment
 * @property {{ path?: string, pathNot?: string[] }} from
 * @property {{ path?: string, pathNot?: string[], circular?: boolean }} to
 */

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Regex matching an npm package (or `@scope` prefix) whether the module was
 * resolved into `node_modules` or could not be resolved at all (in which case
 * dependency-cruiser reports the raw specifier).
 *
 * @param {string} prefix
 * @returns {string}
 */
function npmPackageRegExp(prefix) {
  const escaped = escapeRegExp(prefix);
  if (prefix.startsWith("@") && !prefix.includes("/")) {
    return `(^|/)node_modules/${escaped}/|^${escaped}/`;
  }
  return `(^|/)node_modules/${escaped}(/|$)|^${escaped}(/|$)`;
}

/**
 * Regex matching modules that belong to a workspace: by source directory, by
 * `node_modules` link, or by raw (unresolved) package specifier.
 *
 * @param {WorkspaceInfo} workspace
 * @returns {string}
 */
function workspaceTargetRegExp(workspace) {
  const escapedName = escapeRegExp(workspace.name);
  const escapedDir = escapeRegExp(workspace.dir);
  return `^${escapedDir}/|(^|/)node_modules/${escapedName}(/|$)|^${escapedName}(/|$)`;
}

/**
 * Test and tool-config files that may import dev-only tooling workspaces
 * (for example `@deutsch-mate/test-kit`).
 */
const TEST_FILE_PATTERNS = [
  "\\.test\\.(ts|tsx)$",
  "\\.smoke\\.ts$",
  "(^|/)vitest[^/]*\\.config\\.(ts|mts)$",
];

/**
 * Builds a complete dependency-cruiser configuration for the pnpm workspace
 * rooted at `repoRootDir`.
 *
 * @param {string} repoRootDir
 * @returns {{ forbidden: ForbiddenRule[], options: Record<string, unknown> }}
 */
function createDependencyCruiserConfig(repoRootDir) {
  const workspaces = loadWorkspaces(repoRootDir);

  /** @type {ForbiddenRule[]} */
  const forbidden = [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Dependency cycles are forbidden anywhere (docs/CODING_STANDARDS.md §5: cycles are checked in CI).",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-generic-dump-packages",
      severity: "error",
      comment:
        "Generic common/utils dumping-ground packages must not exist or be imported (docs/CODING_STANDARDS.md §5).",
      from: {},
      to: {
        path: GENERIC_FORBIDDEN_PACKAGE_PREFIXES.map(npmPackageRegExp).join("|"),
      },
    },
  ];

  // Workspace-to-workspace tier matrix (covers apps importing other apps,
  // clients importing server tiers, and everyone importing app code).
  for (const from of workspaces) {
    const forbiddenTargets = workspaces.filter(
      (candidate) =>
        candidate.name !== from.name && tierImportVerdict(from.tier, candidate) === "forbidden",
    );
    if (forbiddenTargets.length > 0) {
      forbidden.push({
        name: `workspace-boundary--${from.dir.replace(/\//g, "-")}`,
        severity: "error",
        comment:
          `${from.name} (tier "${from.tier}") must not import ` +
          `${forbiddenTargets.map((target) => target.name).join(", ")} ` +
          "(tier import matrix, docs/CODING_STANDARDS.md §5; DM-003).",
        from: { path: `^${escapeRegExp(from.dir)}/` },
        to: { path: forbiddenTargets.map(workspaceTargetRegExp).join("|") },
      });
    }

    const forbiddenPrefixes = forbiddenPackagePrefixesForTier(from.tier);
    if (forbiddenPrefixes.length > 0) {
      forbidden.push({
        name: `tier-packages--${from.dir.replace(/\//g, "-")}`,
        severity: "error",
        comment:
          `${from.name} (tier "${from.tier}") must not import framework/provider/server-only ` +
          "packages reserved for other tiers (docs/CODING_STANDARDS.md §5; DM-003).",
        from: { path: `^${escapeRegExp(from.dir)}/` },
        to: { path: forbiddenPrefixes.map(npmPackageRegExp).join("|") },
      });
    }

    // Dev-only tooling workspaces (test kits) are importable from test files
    // only; production code must never depend on them.
    const toolingTargets = workspaces.filter(
      (candidate) => tierImportVerdict(from.tier, candidate) === "test-only",
    );
    if (toolingTargets.length > 0) {
      forbidden.push({
        name: `tooling-outside-tests--${from.dir.replace(/\//g, "-")}`,
        severity: "error",
        comment:
          `${from.name} may import dev-only tooling workspaces ` +
          `(${toolingTargets.map((target) => target.name).join(", ")}) from test files only (DM-003).`,
        from: {
          path: `^${escapeRegExp(from.dir)}/`,
          pathNot: TEST_FILE_PATTERNS,
        },
        to: { path: toolingTargets.map(workspaceTargetRegExp).join("|") },
      });
    }
  }

  /** @type {{ fileName: string } | undefined} */
  let tsConfig;
  const tsConfigPath = path.join(repoRootDir, "tsconfig.base.json");
  if (fs.existsSync(tsConfigPath)) {
    tsConfig = { fileName: tsConfigPath };
  }

  return {
    forbidden,
    options: {
      baseDir: repoRootDir,
      // Build artifacts stay visible as rule targets (a resolved workspace
      // import may point into another package's dist) but are never
      // traversed as sources of their own violations.
      doNotFollow: {
        path: ["node_modules", "^(apps|packages|scripts)/[^/]+/(dist|\\.next|\\.turbo|coverage)/"],
      },
      exclude: {
        // Tool-config files legitimately import the tooling-tier config
        // package; eslint's import hygiene rules govern them instead.
        // Boundary fixtures deliberately violate the rules and are cruised
        // only by the regression tests.
        path: [
          "\\.config\\.(mjs|cjs|js|ts|mts)$",
          "(^|/)eslint\\.config\\.mjs$",
          "(^|/)fixtures/",
          "(^|/)next-env\\.d\\.ts$",
        ],
      },
      ...(tsConfig === undefined ? {} : { tsConfig }),
      enhancedResolveOptions: {
        extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"],
        conditionNames: ["types", "import", "require", "node", "default"],
        mainFields: ["types", "main"],
      },
    },
  };
}

module.exports = { createDependencyCruiserConfig };
