import { existsSync, readFileSync } from "node:fs";
import { createModelClient } from "@agentic-analytics/models";
import { duckdbVersion } from "@agentic-analytics/store";
import { defineCommand, runMain } from "citty";
import { parse } from "yaml";
import { exitCode, formatReport, runDoctor } from "./doctor.ts";

// The CLI reads .env like the server will; values stay in process.env and are never printed.
if (existsSync(".env")) process.loadEnvFile(".env");
const CONFIG_FILE = "agentic-analytics.config.yaml";

const doctor = defineCommand({
  meta: { name: "doctor", description: "Check Node, DuckDB, model providers, SearXNG and Docling; call the planner model once" },
  async run() {
    const results = await runDoctor({
      nodeVersion: process.version,
      duckdbVersion,
      fetch: globalThis.fetch,
      env: process.env,
      modelClient: (config) => createModelClient(config, { env: process.env }),
      ...(existsSync(CONFIG_FILE) ? { configFile: parse(readFileSync(CONFIG_FILE, "utf8")) as unknown } : {}),
    });
    process.stdout.write(formatReport(results));
    process.exitCode = exitCode(results);
  },
});

export const main = defineCommand({
  meta: { name: "aa", description: "agentic-analytics: files in, verified report out" },
  subCommands: { doctor },
});

await runMain(main);
