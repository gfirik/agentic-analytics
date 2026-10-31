// The data behind the Learn section (docs/DOCS-SITE.md §1; types in src/components/learn/types.ts). Nothing on a
// Learn page is typed by hand: every number, fact id, SQL text, quote, retrieval rank, verifier count, call-log record
// and terminal transcript is recorded here from real engine runs on examples/coffee-roaster, offline and
// deterministic (scripted planner, hash embedder, the offline web fixture). Formatting is presentation only.
//   tsx apps/docs/scripts/learn-data.ts --write   → docs/assets/learn/learn.json (checked in)
// scripts/test/learn.test.ts regenerates it and fails on drift.
//
// What runs, one module per stage in learn/:
//   1. run.ts: one web-enabled job, the same run as the README GIF and the landing page (pipeline-data.ts
//      recordRun()), with the planner's tool calls and structured answers recorded and the workspace read after the run;
//   2. cli.ts: the CLI itself (`aa analyze`, `aa metrics`, `aa explain`, `aa eval`), spawned with a clean environment
//      in a scratch folder, for the tutorials' transcripts;
//   3. mcp.ts: the MCP server through the MCP SDK's in-memory client;
//   4. router.ts: the model router on a scripted transport (no network, no keys);
//   5. security.ts: one injection fixture through a full job, the injection screen on every fixture, and the URL checks.
// real.ts reads the committed real-data results, flows.ts builds each page's stage flow from the recorded data, and
// shared.ts holds what they share. This file assembles them and writes learn.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LearnData } from "../src/components/learn/types.ts";
import { cliRuns } from "./learn/cli.ts";
import { flows } from "./learn/flows.ts";
import { mcpRun } from "./learn/mcp.ts";
import { realChecks } from "./learn/real.ts";
import { routerRun } from "./learn/router.ts";
import { stageRun } from "./learn/run.ts";
import { securityRun } from "./learn/security.ts";
import { ROOT, TODAY } from "./learn/shared.ts";

export { LearnDataError } from "./learn/shared.ts";

export const LEARN_JSON = join(ROOT, "docs", "assets", "learn", "learn.json");

export async function recordLearn(): Promise<LearnData> {
  const [stage, cli, mcp, router, security] = await Promise.all([stageRun(), cliRuns(), mcpRun(), routerRun(), securityRun()]);
  const real = realChecks();
  const base: Omit<LearnData, "flows"> = {
    run: {
      example: "examples/coffee-roaster",
      model: "scripted planner (coffeePlanner), no LLM",
      web: "offline web fixture (coffeeWeb)",
      embedder: "hash (offline)",
      today: TODAY,
      ...stage.run,
    },
    facts: stage.facts,
    ingest: stage.ingest,
    metrics: stage.metrics,
    analysis: { ...stage.analysis, real: real.checks, realFile: real.file },
    retrieval: stage.retrieval,
    web: stage.web,
    agent: stage.agent,
    verifier: stage.verifier,
    report: stage.report,
    router,
    security: {
      quarantined: stage.web.results.filter((r) => r.outcome === "quarantined").map((r) => ({ source: "web", url: r.url, reason: r.why })),
      ...security,
    },
    transcripts: cli.transcripts,
    tutorials: { evidence: cli.evidence, mcp, metricsYaml: cli.saved },
  };
  return { ...base, flows: flows(base) };
}

export const learnJson = (d: LearnData) => `${JSON.stringify(d, null, 2)}\n`;

if (process.argv[1]?.endsWith("learn-data.ts") && process.argv.includes("--write")) {
  mkdirSync(join(LEARN_JSON, ".."), { recursive: true });
  writeFileSync(LEARN_JSON, learnJson(await recordLearn()));
  process.stdout.write(`wrote ${LEARN_JSON}\n`);
}
