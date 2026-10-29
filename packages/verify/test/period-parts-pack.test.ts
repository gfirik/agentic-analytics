// A table whose period is a year and a month column (Montgomery County's shape, semantics §2.1) gets a date range from
// the pair and the sales KPI pack drafted by code on the catalog's `_period` (analysis-library §8.1), so the Pareto and
// concentration section runs on it with no metric file. Two money columns hold the same role (`amount`): revenue reads
// the first one in column order when their scores tie (semantics §1).
import { type AnalysisResult, analyzeJob } from "@agentic-analytics/analysis";
import { ingest } from "@agentic-analytics/ingest";
import { fallbackMetrics, loadCatalog, PERIOD_COLUMN, validateMetrics } from "@agentic-analytics/metrics";
import { type ProfileSummary, profileJob } from "@agentic-analytics/profile";
import type { MetricDef } from "@agentic-analytics/schema";
import { Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recomputeFacts } from "../src/index.ts";

// Store sales a month — 2018: X 60, Y 30, Z 10; 2019: X 40, Y 40, Z 20. Bulk sales: X 5, Y 5, Z 90 every month. The
// first money column sorts after the second by name, so the test tells column order from name order.
const csv = (() => {
  const rows = ["Calendar Year,Month,Supplier,Store Sales,Bulk Sales"];
  for (const [year, retail] of [
    [2018, [60, 30, 10]],
    [2019, [40, 40, 20]],
  ] as const)
    for (let m = 1; m <= 12; m++)
      ["X", "Y", "Z"].forEach((s, i) => {
        rows.push(`${year},${m},${s},$${retail[i]}.00,$${[5, 5, 90][i]}.00`);
      });
  return `${rows.join("\n")}\n`;
})();

let ws: Workspace;
let summary: ProfileSummary;
let defs: MetricDef[];
let result: AnalysisResult;
beforeAll(async () => {
  ws = await Workspace.open();
  summary = await profileJob(ws, await ingest([{ name: "warehouse.csv", bytes: new TextEncoder().encode(csv) }]), { today: "2020-02-01" });
  const v = validateMetrics(fallbackMetrics(summary), await loadCatalog(ws));
  expect(v.rejected).toEqual([]);
  defs = v.accepted;
  result = await analyzeJob(ws, defs, await loadCatalog(ws), { from: "2018-01", to: "2019-12" });
}, 120_000);
afterAll(() => ws.close());

const value = (label: string) => {
  const f = result.facts.find((x) => x.label === label);
  if (!f) throw new Error(`no fact ${label}`);
  return f.value;
};

describe("a year and month table", () => {
  it("has a date range from the pair: the first day of its first and last month", () => {
    expect(summary.tables[0]?.date_column).toBeUndefined();
    expect(summary.tables[0]?.date_first).toBe("2018-01-01");
    expect(summary.tables[0]?.date_last).toBe("2019-12-01");
    expect(summary.tables[0]?.grain).toBe("month");
  });

  it("gets the pack's revenue on `_period`, from the first money column with the amount role", () => {
    const revenue = defs.find((d) => d.id === "revenue");
    expect(revenue?.time_column).toBe(PERIOD_COLUMN);
    expect(revenue?.expression).toBe("store_sales");
  });

  it("states revenue per month and the supplier Pareto: 2019 is X 480, Y 480, Z 240 of 1,200", () => {
    expect(value("revenue_2019-12")).toBe(100);
    expect(value("pareto.a_count.supplier_ttm")).toBe(2);
    expect(value("top1_share.supplier_2019")).toBe(40);
    expect(value("hhi.supplier_2019")).toBeCloseTo(0.36, 12);
    // 2018: X 720, Y 360, Z 120 → (0.6² + 0.3² + 0.1²) = 0.46.
    expect(value("hhi.supplier_2018")).toBeCloseTo(0.46, 12);
    expect(result.notRun.filter((n) => n.analysis === "pareto.v1" || n.analysis === "concentration")).toEqual([]);
  });

  it("every fact passes V2", async () => {
    const checks = await recomputeFacts(ws, result.facts, new Map(result.facts.map((f) => [f.id, f])));
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  });
});
