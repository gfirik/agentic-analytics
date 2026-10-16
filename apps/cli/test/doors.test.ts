// M10 acceptance: the same dataset gives an identical report.json (facts) via the CLI, the API and MCP. Each door
// gets its own job folder and its own scripted planner; the facts — ids, labels, values, units, computations and
// citations — must be equal, and so must the verified findings.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobManager } from "@agentic-analytics/core";
import { coffeePlanner } from "@agentic-analytics/core/testing";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { createMcpServer } from "@agentic-analytics/mcp";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import type { Report } from "@agentic-analytics/schema";
import { createApp } from "@agentic-analytics/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, describe, expect, it } from "vitest";
import { analyzeCommand } from "../src/analyze.ts";

const tmp = mkdtempSync(join(tmpdir(), "aa-doors-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const data = coffeeRoasterFiles();
const manager = (door: string) =>
  new JobManager({ root: join(tmp, door), model: coffeePlanner(), deps: () => ({ model: coffeePlanner(), embedder: hashEmbedder() }) });

async function viaCli(): Promise<Report> {
  const r = await analyzeCommand(
    {
      files: Object.entries(data).map(([name, bytes]) => ({ name, bytes })),
      options: { today: "2026-07-01", currency: "USD" },
      out: join(tmp, "cli-out"),
    },
    { manager: manager("cli"), print: () => undefined },
  );
  return JSON.parse(readFileSync(r.reportPath as string, "utf8")) as Report;
}

async function viaApi(): Promise<Report> {
  const app = createApp(manager("api"), { today: () => "2026-07-01" });
  const form = new FormData();
  for (const [name, bytes] of Object.entries(data)) form.append("files[]", new File([bytes], name));
  form.append("options", JSON.stringify({ currency: "USD" }));
  const { job_id } = (await (await app.request("/v1/jobs", { method: "POST", body: form })).json()) as { job_id: string };
  await (await app.request(`/v1/jobs/${job_id}/events`)).text(); // the stream ends when the job does
  return (await (await app.request(`/v1/jobs/${job_id}/report`)).json()) as Report;
}

async function viaMcp(): Promise<Report> {
  const dir = join(tmp, "mcp-files");
  mkdirSync(dir);
  for (const [name, bytes] of Object.entries(data)) writeFileSync(join(dir, name), bytes);
  const client = new Client({ name: "doors", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(manager("mcp"), { today: () => "2026-07-01" }).connect(a);
  await client.connect(b);
  const started = (await client.callTool({ name: "analyze_files", arguments: { paths: [dir], currency: "USD", wait: true } })) as {
    content: { text: string }[];
  };
  const jobId = started.content[0]?.text.split(":")[0] as string;
  const r = (await client.callTool({ name: "get_report", arguments: { job_id: jobId, format: "json" } })) as {
    content: { text: string }[];
  };
  return JSON.parse(r.content[0]?.text ?? "{}") as Report;
}

describe("doors give the same report (M10 acceptance)", () => {
  it("CLI, API and MCP: identical facts and verified findings", async () => {
    const [cli, api, mcp] = await Promise.all([viaCli(), viaApi(), viaMcp()]);
    expect(cli.facts.length).toBeGreaterThan(50);
    expect(api.facts).toEqual(cli.facts);
    expect(mcp.facts).toEqual(cli.facts);
    const findings = (r: Report) => r.findings.map((f) => ({ title: f.title, claims: f.claims }));
    expect(findings(api)).toEqual(findings(cli));
    expect(findings(mcp)).toEqual(findings(cli));
    expect(api.verification).toEqual(cli.verification);
    expect(mcp.verification).toEqual(cli.verification);
  }, 300_000);
});
