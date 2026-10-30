// 3. MCP (learn-data.ts): the server `aa mcp` runs, through the SDK's in-memory client.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobManager } from "@agentic-analytics/core";
import { coffeePlanner } from "@agentic-analytics/core/testing";
import { createMcpServer } from "@agentic-analytics/mcp";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { coffeeFiles, need, short, TODAY } from "./shared.ts";

export async function mcpRun() {
  const tmp = mkdtempSync(join(tmpdir(), "aa-learn-mcp-"));
  try {
    const input = join(tmp, "coffee-roaster");
    mkdirSync(input);
    for (const f of coffeeFiles()) writeFileSync(join(input, f.name), f.bytes);
    const manager = new JobManager({
      root: join(tmp, "jobs"),
      model: coffeePlanner(),
      deps: () => ({ model: coffeePlanner(), embedder: hashEmbedder() }),
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(manager, { today: () => TODAY }).connect(a);
    const client = new Client({ name: "learn", version: "0" });
    await client.connect(b);
    try {
      const textOf = (r: unknown) => (r as { content: { text: string }[] }).content[0]?.text ?? "";
      const { tools } = await client.listTools();
      const shown = "/path/to/agentic-analytics/examples/coffee-roaster";
      const call = async (tool: string, args: Record<string, unknown>, shownArgs = args) => {
        const t = textOf(await client.callTool({ name: tool, arguments: args }));
        return { tool, args: shownArgs, result: t.split(input).join(shown) };
      };
      const analyzed = await call(
        "analyze_files",
        { paths: [input], currency: "USD", wait: true },
        { paths: [shown], currency: "USD", wait: true },
      );
      const jobId = need(/^([\w-]+): /.exec(analyzed.result)?.[1], "the MCP job id");
      const explained = await call("explain_number", { job_id: jobId, fact_id: "N30" });
      const asked = await call("ask_report", { job_id: jobId, question: "Why did revenue drop in April?" });
      const norm = (c: { tool: string; args: unknown; result: string }) => ({
        ...c,
        args: JSON.parse(JSON.stringify(c.args).split(jobId).join("<job-id>")) as unknown,
        result: c.result.split(jobId).join("<job-id>"),
      });
      return {
        tools: tools.map((t) => ({ name: t.name, description: t.description ?? "" })).sort((x, y) => x.name.localeCompare(y.name)),
        calls: [analyzed, explained, asked].map(norm).map((c) => ({ ...c, result: short(c.result, 1400) })),
      };
    } finally {
      await client.close();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
