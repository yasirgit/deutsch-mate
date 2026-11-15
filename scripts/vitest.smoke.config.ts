import { defineConfig } from "vitest/config";

/**
 * Smoke tests exercise the live local stack (compose.yaml services and the
 * compiled API), so they are excluded from the default `test` task and run
 * serially for determinism via `pnpm test:smoke`.
 */
export default defineConfig({
  test: {
    include: ["smoke/**/*.smoke.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
