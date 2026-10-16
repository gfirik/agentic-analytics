// M10: the MCP door. An in-memory client lists the tools and resources, runs a job on files, and reads the report,
// an answer and an explanation; tool descriptions tell the calling model not to recalculate numbers.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobManager } from "@agentic-analytics/core";
import { coffeePlanner } from "@agentic-analytics/core/testing";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import type { Report } from "@agentic-analytics/schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/index.ts";

const tmp = mkdtempSync(join(tmpdir(), "aa-mcp-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const input = join(tmp, "files");
const manager = new JobManager({
  root: join(tmp, "jobs"),
  model: coffeePlanner(),
  deps: () => ({ model: coffeePlanner(), embedder: hashEmbedder() }),
});
const client = new Client({ name: "test", version: "0" });

const textOf = (r: unknown) => (r as { content: { text: string }[] }).content[0]?.text ?? "";
let jobId: string;

beforeAll(async () => {
  mkdirSync(input);
  for (const [name, bytes] of Object.entries(coffeeRoasterFiles())) writeFileSync(join(input, name), bytes);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(manager, { today: () => "2026-07-01" }).connect(a);
  await client.connect(b);
}, 30_000);

describe("MCP server", () => {
  it("lists the five tools, each telling the model to quote numbers, not recalculate them", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["analyze_files", "ask_report", "confirm_metrics", "explain_number", "get_report"]);
    for (const t of tools.filter((x) => x.name !== "confirm_metrics")) expect(t.description, t.name).toMatch(/never recalculate/);
  });

  it("analyze_files with wait returns the summary; get_report, the resources, ask and explain work", async () => {
    const r = await client.callTool({ name: "analyze_files", arguments: { paths: [input], currency: "USD", wait: true } });
    const t = textOf(r);
    jobId = t.split(":")[0] as string;
    expect(t).toMatch(/: done/);
    expect(t).not.toMatch(/\{\{N\d+\}\}/);
    const full = JSON.parse(textOf(await client.callTool({ name: "get_report", arguments: { job_id: jobId, format: "json" } }))) as Report;
    expect(full.findings.length).toBeGreaterThan(0);
    const { resources } = await client.listResources();
    expect(resources.map((x) => x.uri)).toContain(`report://${jobId}`);
    const res = await client.readResource({ uri: `report://${jobId}` });
    expect(JSON.parse((res.contents[0] as { text: string }).text)).toEqual(full);
    const html = await client.readResource({ uri: `report-html://${jobId}` });
    expect((html.contents[0] as { text: string }).text).toMatch(/^<!doctype html>/i);
    const ask = JSON.parse(
      textOf(await client.callTool({ name: "ask_report", arguments: { job_id: jobId, question: "Why did revenue drop?" } })),
    );
    expect(ask.claims.length).toBe(1);
    expect(ask.dropped.length).toBe(1);
    const fact = full.facts.find((f) => f.computation.kind === "sql");
    const ex = JSON.parse(textOf(await client.callTool({ name: "explain_number", arguments: { job_id: jobId, fact_id: fact?.id } })));
    expect(ex.fact.id).toBe(fact?.id);
  }, 180_000);

  it("reports errors as tool errors", async () => {
    const r = await client.callTool({ name: "get_report", arguments: { job_id: "missing" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/^NOT_FOUND/);
  });
});
