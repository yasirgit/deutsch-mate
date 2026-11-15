"use strict";

/**
 * Workspace ownership metadata and the tier import matrix (DM-003,
 * `docs/CODING_STANDARDS.md` §5, §16).
 *
 * Every workspace `package.json` declares `"dm": { "tier": ... }`. The lint
 * boundary rules (`eslint.config.mjs`) and the dependency-graph policy
 * (`dependency-cruiser.cjs`) both read tiers from the manifests instead of
 * hardcoding paths, so moving or adding a workspace only requires correct
 * metadata.
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * @typedef {"domain" | "shared" | "client" | "server" | "worker" | "tooling"} WorkspaceTier
 *
 * @typedef {object} WorkspaceInfo
 * @property {string} name npm package name, e.g. `@deutsch-mate/domain`.
 * @property {string} dir POSIX path of the workspace relative to the repo root.
 * @property {WorkspaceTier} tier declared `dm.tier`.
 * @property {boolean} isClientSafe `dm.clientSafe === true`; only meaningful for `shared`.
 *
 * @typedef {"allowed" | "forbidden" | "test-only"} EdgeVerdict
 */

const WORKSPACE_TIERS = /** @type {readonly WorkspaceTier[]} */ ([
  "domain",
  "shared",
  "client",
  "server",
  "worker",
  "tooling",
]);

/**
 * Workspace-to-workspace import matrix. A tier may import workspaces of the
 * listed tiers only. `client` additionally requires `dm.clientSafe: true` on
 * the target, and `tooling` targets are allowed from test files of any tier
 * (they are dev-only and blocked from production code by
 * `import-x/no-extraneous-dependencies`).
 *
 * @type {Readonly<Record<WorkspaceTier, readonly WorkspaceTier[]>>}
 */
const ALLOWED_TIER_IMPORTS = {
  domain: ["domain"],
  shared: ["domain", "shared"],
  client: ["shared"],
  server: ["domain", "shared"],
  worker: ["domain", "shared"],
  tooling: ["domain", "shared", "tooling"],
};

/**
 * Framework/provider adapter packages the pure domain tier must never import
 * (`docs/CODING_STANDARDS.md` §5: adapters implement domain-owned ports).
 * Entries are npm package names, or scopes when they start with `@` and
 * contain no `/`.
 */
const DOMAIN_FORBIDDEN_PACKAGE_PREFIXES = /** @type {readonly string[]} */ ([
  "@nestjs",
  "next",
  "react",
  "react-dom",
  "react-native",
  "expo",
  "express",
  "fastify",
  "@aws-sdk",
  "aws-sdk",
  "pg",
  "pg-pool",
  "pg-cursor",
  "pg-protocol",
  "kysely",
  "ioredis",
  "redis",
  "stripe",
  "openai",
  "langchain",
  "@langchain",
  "langgraph",
  "@langgraph",
  "@deutsch-mate/database",
]);

/**
 * Server-only packages that web and mobile clients must never import
 * (`docs/CODING_STANDARDS.md` §5: clients consume generated API clients and
 * client-safe shared packages only).
 */
const SERVER_ONLY_PACKAGE_PREFIXES = /** @type {readonly string[]} */ ([
  "@nestjs",
  "express",
  "fastify",
  "@aws-sdk",
  "aws-sdk",
  "pg",
  "pg-pool",
  "pg-cursor",
  "pg-protocol",
  "kysely",
  "ioredis",
  "redis",
  "stripe",
  "openai",
  "langchain",
  "@langchain",
  "langgraph",
  "@langgraph",
  "@deutsch-mate/database",
]);

/**
 * Client UI frameworks that the API and workers must never import.
 */
const CLIENT_ONLY_PACKAGE_PREFIXES = /** @type {readonly string[]} */ ([
  "next",
  "react",
  "react-dom",
  "react-native",
  "expo",
]);

/**
 * Generic dumping-ground package names that must not exist and must never be
 * imported (`docs/CODING_STANDARDS.md` §5; AI_CONTEXT "no common/utils").
 */
const GENERIC_PACKAGE_BASENAMES = /** @type {readonly string[]} */ ([
  "common",
  "utils",
  "util",
  "helpers",
  "helper",
  "shared",
  "misc",
  "lib",
  "core",
]);

const GENERIC_FORBIDDEN_PACKAGE_PREFIXES = GENERIC_PACKAGE_BASENAMES.map(
  (basename) => `@deutsch-mate/${basename}`,
);

/**
 * Walks upward from `startDir` to the directory containing
 * `pnpm-workspace.yaml`.
 *
 * @param {string} startDir
 * @returns {string} absolute repository root path.
 */
function findRepoRoot(startDir) {
  let current = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`pnpm-workspace.yaml not found above ${startDir}`);
    }
    current = parent;
  }
}

/**
 * Minimal parser for the repository's `pnpm-workspace.yaml`, which is a flat
 * `packages:` list. Avoids a YAML dependency on purpose.
 *
 * @param {string} repoRootDir
 * @returns {string[]} workspace directory patterns, e.g. `apps/*`.
 */
function readWorkspacePatterns(repoRootDir) {
  const raw = fs.readFileSync(path.join(repoRootDir, "pnpm-workspace.yaml"), "utf8");
  /** @type {string[]} */
  const patterns = [];
  for (const line of raw.split("\n")) {
    const match = /^\s*-\s*["']?([^"'#\s]+)["']?\s*$/.exec(line);
    const pattern = match?.[1];
    if (pattern !== undefined) {
      patterns.push(pattern);
    }
  }
  if (patterns.length === 0) {
    throw new Error(`no workspace patterns found in ${repoRootDir}/pnpm-workspace.yaml`);
  }
  return patterns;
}

/**
 * @param {unknown} value
 * @returns {value is WorkspaceTier}
 */
function isWorkspaceTier(value) {
  return (
    typeof value === "string" && WORKSPACE_TIERS.includes(/** @type {WorkspaceTier} */ (value))
  );
}

/**
 * Reads one workspace manifest into a {@link WorkspaceInfo}, enforcing the
 * ownership metadata convention and the "no generic dumping ground" rule.
 *
 * @param {string} repoRootDir
 * @param {string} workspaceDir workspace path relative to the repo root.
 * @returns {WorkspaceInfo}
 */
function readWorkspaceInfo(repoRootDir, workspaceDir) {
  const manifestPath = path.join(repoRootDir, workspaceDir, "package.json");
  const manifest = /** @type {Record<string, unknown>} */ (
    JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  );
  const name = manifest["name"];
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`${manifestPath} is missing a package name`);
  }
  const basename = name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
  if (GENERIC_PACKAGE_BASENAMES.includes(basename)) {
    throw new Error(
      `${manifestPath}: generic dumping-ground package "${name}" is forbidden ` +
        `(docs/CODING_STANDARDS.md §5); use a narrowly named package instead`,
    );
  }
  const dm = manifest["dm"];
  if (typeof dm !== "object" || dm === null) {
    throw new Error(
      `${manifestPath} is missing the "dm" ownership metadata object ` +
        `(expected "dm": { "tier": ${WORKSPACE_TIERS.join(" | ")} })`,
    );
  }
  const tier = /** @type {Record<string, unknown>} */ (dm)["tier"];
  if (!isWorkspaceTier(tier)) {
    throw new Error(
      `${manifestPath} has an invalid "dm.tier" (${JSON.stringify(tier)}); ` +
        `expected one of: ${WORKSPACE_TIERS.join(", ")}`,
    );
  }
  const isClientSafe = /** @type {Record<string, unknown>} */ (dm)["clientSafe"] === true;
  return {
    name,
    dir: workspaceDir.split(path.sep).join("/"),
    tier,
    isClientSafe,
  };
}

/**
 * Loads {@link WorkspaceInfo} for every workspace declared in
 * `pnpm-workspace.yaml` (the private root manifest is not a tiered
 * workspace and is excluded).
 *
 * @param {string} repoRootDir
 * @returns {WorkspaceInfo[]}
 */
function loadWorkspaces(repoRootDir) {
  /** @type {WorkspaceInfo[]} */
  const workspaces = [];
  for (const pattern of readWorkspacePatterns(repoRootDir)) {
    /** @type {string[]} */
    const dirs = [];
    if (pattern.endsWith("/*")) {
      const parent = pattern.slice(0, -2);
      const parentPath = path.join(repoRootDir, parent);
      if (fs.existsSync(parentPath)) {
        for (const entry of fs.readdirSync(parentPath, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            dirs.push(path.posix.join(parent, entry.name));
          }
        }
      }
    } else {
      dirs.push(pattern);
    }
    for (const dir of dirs) {
      if (fs.existsSync(path.join(repoRootDir, dir, "package.json"))) {
        workspaces.push(readWorkspaceInfo(repoRootDir, dir));
      }
    }
  }
  if (workspaces.length === 0) {
    throw new Error(`no workspaces found under ${repoRootDir}`);
  }
  return workspaces;
}

/**
 * Verdict for one tier importing one workspace. `test-only` means the import
 * is acceptable from test/tooling-config files only (dev-only test kits).
 *
 * @param {WorkspaceTier} fromTier
 * @param {WorkspaceInfo} toWorkspace
 * @returns {EdgeVerdict}
 */
function tierImportVerdict(fromTier, toWorkspace) {
  if (toWorkspace.tier === "tooling") {
    return fromTier === "tooling" ? "allowed" : "test-only";
  }
  const allowedTiers = ALLOWED_TIER_IMPORTS[fromTier];
  if (!allowedTiers.includes(toWorkspace.tier)) {
    return "forbidden";
  }
  if (fromTier === "client" && toWorkspace.tier === "shared" && !toWorkspace.isClientSafe) {
    return "forbidden";
  }
  return "allowed";
}

/**
 * npm package/scope prefixes forbidden for a tier, beyond the workspace
 * matrix. Empty for tiers with no extra bans.
 *
 * @param {WorkspaceTier} tier
 * @returns {readonly string[]}
 */
function forbiddenPackagePrefixesForTier(tier) {
  switch (tier) {
    case "domain":
      return DOMAIN_FORBIDDEN_PACKAGE_PREFIXES;
    case "client":
      return SERVER_ONLY_PACKAGE_PREFIXES;
    case "server":
    case "worker":
      return CLIENT_ONLY_PACKAGE_PREFIXES;
    case "shared":
    case "tooling":
      return [];
    default: {
      /** @type {never} */
      const exhaustive = tier;
      throw new Error(`unhandled tier ${String(exhaustive)}`);
    }
  }
}

module.exports = {
  WORKSPACE_TIERS,
  ALLOWED_TIER_IMPORTS,
  DOMAIN_FORBIDDEN_PACKAGE_PREFIXES,
  SERVER_ONLY_PACKAGE_PREFIXES,
  CLIENT_ONLY_PACKAGE_PREFIXES,
  GENERIC_FORBIDDEN_PACKAGE_PREFIXES,
  findRepoRoot,
  loadWorkspaces,
  tierImportVerdict,
  forbiddenPackagePrefixesForTier,
};
