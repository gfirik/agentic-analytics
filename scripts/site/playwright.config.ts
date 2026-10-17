// Browser checks for the product site (apps/docs/DESIGN.md §8, §10), run as their own CI job after a site build:
// `bun run site:check:browser`. It serves the built site (apps/docs/dist) with `astro preview`.
// Locally, PW_CHANNEL=chrome uses an installed Chrome instead of Playwright's own build.
import { defineConfig } from "@playwright/test";

const PORT = 4329;

export default defineConfig({
  testDir: "browser",
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    headless: true,
    baseURL: `http://127.0.0.1:${PORT}`,
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  webServer: {
    command: `bun run --filter @agentic-analytics/docs preview --port ${PORT} --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/agentic-analytics/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
