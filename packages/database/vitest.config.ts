import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration suites share cluster-global roles (ALTER ROLE LOGIN).
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
