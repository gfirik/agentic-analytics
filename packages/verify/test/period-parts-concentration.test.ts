// A table with a year and a month column and no date column (Montgomery County's shape, semantics §2.1) gets periods from
// the pair, so the Pareto windows and the trailing year work on it (analysis-library §11.1).
import { type AnalysisResult, analyzeJob } from "@agentic-analytics/analysis";
import { ingest } from "@agentic-analytics/ingest";
import { loadCatalog, PERIOD_COLUMN, validateMetrics } from "@agentic-analytics/metrics";
import { profileJob } from "@agentic-analytics/profile";
import { Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recomputeFacts } from "../src/index.ts";

// 2018: X 60, Y 30, Z 10 a month. 2019: X 40, Y 40, Z 20 a month.
const csv = (() => {
  const rows = ["calendar_year,cal_month_num,supplier,amount"];
  for (const [year, [x, y, z]] of [
    [2018, [60, 30, 10]],
    [2019, [40, 40, 20]],
  ] as const)
    for (let m = 1; m <= 12; m++)
      for (const [s, v] of [
        ["X", x],
        ["Y", y],
        ["Z", z],
      ] as const)
        rows.push(`${year},${m},${s},${v}`);
  return `${rows.join("\n")}\n`;
})();

let ws: Workspace;
let result: AnalysisResult;
beforeAll(async () => {
  ws = await Workspace.open();
  const summary = await profileJob(ws, await ingest([{ name: "warehouse.csv", bytes: new TextEncoder().encode(csv) }]), {
    today: "2020-02-01",
  });
  const catalog = await loadCatalog(ws);
  const table = summary.tables[0]?.name as string;
  expect(catalog.get(table)?.dateColumn).toBe(PERIOD_COLUMN);
  const v = validateMetrics(
    [
      {
        id: "revenue",
        label: "Revenue",
        type: "sum",
        table,
        expression: "amount",
        unit: "currency",
        currency: "USD",
        dimensions: ["supplier"],
      },
    ],
    catalog,
  );
  expect(v.rejected).toEqual([]);
  result = await analyzeJob(ws, v.accepted, catalog, { from: "2018-01", to: "2019-12" });
}, 120_000);
afterAll(() => ws.close());

const value = (label: string) => {
  const f = result.facts.find((x) => x.label === label);
  if (!f) throw new Error(`no fact ${label}`);
  return f.value;
};

describe("a table with year and month columns and no date column", () => {
  it("has monthly periods, so the trailing year is 2019", () => {
    expect(value("pareto.members.supplier_ttm")).toBe(3);
    // 2019: X 480, Y 480, Z 240 (T = 1200): X is 40%; X and Y reach 80% together, which is class A.
    expect(value("top1_share.supplier_ttm")).toBe(40);
    expect(value("pareto.a_count.supplier_ttm")).toBe(2);
    expect(value("pareto.a_value.supplier_ttm")).toBe(960);
    expect(value("hhi.supplier_ttm")).toBeCloseTo(0.36, 12);
  });

  it("states the year before it: 2018 is X 720, Y 360, Z 120, so A = {X}, B = {Y}, C = {Z} and the HHI is 0.46", () => {
    expect(value("pareto.a_count.supplier_ttm_prev")).toBe(1);
    expect(value("pareto.a_value.supplier_ttm_prev")).toBe(720);
    expect(value("pareto.b_value.supplier_ttm_prev")).toBe(360);
    expect(value("pareto.c_value.supplier_ttm_prev")).toBe(120);
    expect(result.notRun).toEqual([]);
  });

  it("states each complete calendar year, and every fact passes V2", async () => {
    expect(value("top1_share.supplier_2018")).toBe(60);
    expect(value("hhi.supplier_2018")).toBeCloseTo(0.46, 12);
    const checks = await recomputeFacts(ws, result.facts, new Map(result.facts.map((f) => [f.id, f])));
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  });
});
