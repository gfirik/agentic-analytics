import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "evals/*/test/**/*.test.ts", "scripts/test/**/*.test.ts"],
    passWithNoTests: false,
    testTimeout: 20_000,
    // Two workers at most: the gate runs on laptops next to other agents' worktrees (AGENTS.md §9).
    maxWorkers: 2,
  },
});
