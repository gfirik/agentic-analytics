// MEASURE over the job's periods and DECOMPOSE on a zero total change (analysis-library §1, §3), on a small
// hand-built workspace. Revenue by month (Jan–Aug 2026) is 120, 100, 110, 110, 120, 120, 180, 180: store B has no
// rows in February (its 0 there is covered in periods.test.ts), and costs alone run into September.
import { ingest } from "@agentic-analytics/ingest";
import { loadCatalog } from "@agentic-analytics/metrics";
import { profileJob } from "@agentic-analytics/profile";
import type { MetricDef } from "@agentic-analytics/schema";
import { Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AnalysisResult, analyzeJob } from "../src/index.ts";

const months = ["01", "02", "03", "04", "05", "06", "07", "08"];
const a = [60, 100, 55, 55, 60, 70, 90, 90];
const b = [60, null, 55, 55, 60, 50, 90, 90];
const orders = [
  "date,store,amount",
  ...months.flatMap((m, i) => [`2026-${m}-10,A,${a[i]}`, ...(b[i] === null ? [] : [`2026-${m}-12,B,${b[i]}`])]),
].join("\n");
const costs = ["date,cost", ...[...months, "09"].map((m) => `2026-${m}-01,40`)].join("\n");

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
  const defs = [
    {
      id: "revenue",
      label: "Revenue",
      type: "sum",
      table: table("orders.csv"),
      expression: "amount",
      unit: "currency",
      dimensions: ["store"],
      status: "assumed",
    },
    { id: "costs", label: "Costs", type: "sum", table: table("costs.csv"), expression: "cost", unit: "currency", status: "assumed" },
  ] as MetricDef[];
  result = await analyzeJob(ws, defs, await loadCatalog(ws), { from: "2026-01", to: "2026-09" });
}, 120_000);
afterAll(() => ws.close());

describe("runner: periods and zero changes", () => {
  it("a material level shift whose edge points are equal (May 120 = June 120) is not split by member: no NaN share, no crash", () => {
    // Before the fix the zero total change made every member share 0/0 and FactBook.calc threw NO_VALUE.
    const shift = result.insights.find((i) => i.template === "trend_break.v1" && i.metric === "revenue" && !i.member);
    expect(shift).toMatchObject({ period: "2026-06", material: true });
    expect(result.decompositions.some((d) => d.insight === shift?.id)).toBe(false);
    expect(result.facts.every((f) => Number.isFinite(f.value))).toBe(true);
  });

  it("revenue's series stops at its own last month: no zero September from the costs table", () => {
    const latest = result.insights.filter((i) => i.metric === "revenue" && !i.member).map((i) => i.period);
    expect(latest).not.toContain("2026-09");
    expect(result.facts.some((f) => f.label === "revenue_2026-09")).toBe(false);
  });
});
