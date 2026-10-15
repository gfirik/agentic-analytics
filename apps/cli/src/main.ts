import { existsSync } from "node:fs";
import { duckdbVersion } from "@agentic-analytics/store";
import { defineCommand, runMain } from "citty";
import { exitCode, formatReport, runDoctor } from "./doctor.ts";

// The CLI reads .env like the server will; values stay in process.env and are never printed.
if (existsSync(".env")) process.loadEnvFile(".env");

const doctor = defineCommand({
  meta: { name: "doctor", description: "Check Node, DuckDB, model providers, SearXNG and Docling" },
  async run() {
    const results = await runDoctor({ nodeVersion: process.version, duckdbVersion, fetch: globalThis.fetch, env: process.env });
    process.stdout.write(formatReport(results));
    process.exitCode = exitCode(results);
  },
});

export const main = defineCommand({
  meta: { name: "aa", description: "agentic-analytics: files in, verified report out" },
  subCommands: { doctor },
});

await runMain(main);
