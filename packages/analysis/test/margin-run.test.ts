// The runner with margin-shaped metrics on a small hand-built workspace: a ratio of two derived metrics whose terms live in
// two tables (as a model's draft can have since validation orders a metric after the metrics it references) must not be
// split by rate vs mix (it has no table to group by), and the job must still complete.
import { ingest } from "@agentic-analytics/ingest";
import { loadCatalog, validateMetrics } from "@agentic-analytics/metrics";
import { profileJob } from "@agentic-analytics/profile";
import { Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AnalysisResult, analyzeJob } from "../src/index.ts";

const months = ["01", "02", "03", "04", "05", "06", "07", "08"];
// Revenue 100 per store per month; costs 80 a month, then 140 in August: net = revenue − costs goes 120 → 60.
const orders = ["date,store,amount", ...months.flatMap((m) => [`2026-${m}-10,A,100`, `2026-${m}-12,B,100`])].join("\n");
const costs = ["date,cost", ...months.map((m) => `2026-${m}-01,${m === "08" ? 140 : 80}`)].join("\n");

let ws: Workspace;
let result: AnalysisResult;
beforeAll(async () => {
  ws = await Workspace.open();
  const enc = new TextEncoder();
  const summary = await profileJob(
    ws,
    await ingest([
      { name: "orders.csv", bytes: enc.encode(orders) },
      { name: "costs.csv", bytes: enc.encode(costs) },
    ]),
    { today: "2026-10-01" },
  );
  const table = (file: string) => summary.tables.find((t) => t.file === file)?.name as string;
  const catalog = await loadCatalog(ws);
  const v = validateMetrics(
    [
      {
        id: "revenue",
        label: "Revenue",
        type: "sum",
        table: table("orders.csv"),
        expression: "amount",
        unit: "currency",
        currency: "GBP",
        dimensions: ["store"],
      },
      { id: "costs", label: "Costs", type: "sum", table: table("costs.csv"), expression: "cost", unit: "currency", currency: "GBP" },
      { id: "net", label: "Net", type: "derived", expression: "revenue - costs", unit: "currency", currency: "GBP", dimensions: ["store"] },
      {
        id: "outlay",
        label: "Outlay",
        type: "derived",
        expression: "revenue + costs",
        unit: "currency",
        currency: "GBP",
        dimensions: ["store"],
      },
      { id: "net_pct", label: "Net %", type: "ratio", numerator: { metric: "net" }, denominator: { metric: "outlay" }, unit: "percent" },
    ],
    catalog,
  );
  // The ratio over the derived metrics is accepted, whichever order the draft lists them in.
  expect(v.rejected).toEqual([]);
  result = await analyzeJob(ws, v.accepted, catalog, { from: "2026-01", to: "2026-08" });
}, 120_000);
afterAll(() => ws.close());

describe("ratio over a derived metric", () => {
  it("is measured and found, and is not split by rate vs mix", () => {
    const shift = result.insights.find((i) => i.metric === "net_pct" && !i.member && i.material);
    expect(shift).toBeDefined();
    expect(result.decompositions.filter((d) => d.method === "ratemix.v1")).toEqual([]);
    expect(result.facts.every((f) => Number.isFinite(f.value))).toBe(true);
  });
});
