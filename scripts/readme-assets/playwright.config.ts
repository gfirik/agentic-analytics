// Browser checks for the README assets (docs/DOCS-SITE.md §3), run as their own CI job: `bun run readme:check:browser`.
// Locally, PW_CHANNEL=chrome uses an installed Chrome instead of Playwright's own build.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "browser",
  timeout: 120_000,
  reporter: [["list"]],
  use: { headless: true, ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) },
});
