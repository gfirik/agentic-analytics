import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "evals/*/test/**/*.test.ts", "scripts/test/**/*.test.ts"],
    passWithNoTests: false,
    testTimeout: 20_000,
  },
});
