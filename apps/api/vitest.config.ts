import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: "forks",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/testing/create-platform-app.test.ts",
      "**/testing/create-identity-app.test.ts",
      "**/testing/create-content-app.test.ts",
    ],
  },
});
