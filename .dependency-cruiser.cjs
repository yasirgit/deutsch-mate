"use strict";

/**
 * Dependency-graph policy for `pnpm boundaries:check` (DM-003). All rules are
 * generated from workspace `dm.tier` ownership metadata; see
 * `packages/config/src/dependency-cruiser.cjs`.
 */

const { createDependencyCruiserConfig } = require("@deutsch-mate/config/dependency-cruiser");

module.exports = createDependencyCruiserConfig(__dirname);
