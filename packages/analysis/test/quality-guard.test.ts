// A change caused by a flagged unit error is data quality, not a finding: on coffee-roaster-v1 the costs sheet has
// February packaging = 1,240,000 (×1000, flagged by profiling). A metric over that column, and one derived from it,
// must produce no insight that compares or reports February, and an open question must say why.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingest } from "@agentic-analytics/ingest";
import { fallbackMetrics, loadCatalog, validateMetrics } from "@agentic-analytics/metrics";
import { profileJob } from "@agentic-analytics/profile";
import { sql, Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AnalysisResult, analyzeJob } from "../src/index.ts";
import { flaggedPeriods } from "../src/quality-guard.ts";

const dir = join(import.meta.dirname, "..", "..", "..", "evals/datasets/coffee-roaster-v1/files");
let ws: Workspace;
let result: AnalysisResult;
let flagged: Awaited<ReturnType<typeof flaggedPeriods>>;

beforeAll(async () => {
  ws = await Workspace.open();
  const files = ["sales-2026.xlsx"].map((f) => ({ name: f, bytes: new Uint8Array(readFileSync(join(dir, f))) }));
  const summary = await profileJob(ws, await ingest(files), { today: "2026-07-01" });
  const catalog = await loadCatalog(ws);
  const costs = [...catalog.values()].find((t) => t.columns.has("packaging"));
  if (!costs) throw new Error("no costs table");
  const time = [...costs.columns.values()].find((c) => c.type === "date")?.name ?? "month";
  const extra = [
    {
      id: "packaging_cost",
      label: "Packaging cost",
      type: "sum",
      table: costs.name,
      expression: "packaging",
      time_column: time,
      unit: "currency",
      currency: "USD",
      status: "assumed",
    },
    {
      id: "rent_cost",
      label: "Rent",
      type: "sum",
      table: costs.name,
      expression: "rent",
      time_column: time,
      unit: "currency",
      currency: "USD",
      status: "assumed",
    },
    {
      id: "margin_after_packaging",
      label: "Margin after packaging",
      type: "derived",
      expression: "revenue - packaging_cost",
      unit: "currency",
      currency: "USD",
      status: "assumed",
    },
  ];
  const defs = validateMetrics([...fallbackMetrics(summary), ...extra], catalog, { defaultCurrency: "USD" }).accepted;
  expect(defs.map((d) => d.id)).toEqual(expect.arrayContaining(["packaging_cost", "margin_after_packaging"]));
  flagged = await flaggedPeriods(ws, defs);
  result = await analyzeJob(ws, defs, catalog, { from: "2026-01", to: "2026-06" });
}, 120_000);
afterAll(() => ws.close());

describe("quality guard", () => {
  it("flags the typo's period for the column's metric and the metric derived from it, and nothing else", async () => {
    const issue = await ws.one<{ message: string }>(sql`SELECT message FROM quality_issues WHERE kind = 'unit_error'`);
    expect(issue?.message).toMatch(/Packaging/);
    expect([...(flagged.get("packaging_cost")?.periods ?? [])]).toEqual(["2026-02"]);
    expect([...(flagged.get("margin_after_packaging")?.periods ?? [])]).toEqual(["2026-02"]);
    expect(flagged.has("rent_cost")).toBe(false);
    expect(flagged.has("revenue")).toBe(false);
  });

  it("withholds every insight that compares or reports February on those metrics, and says why", () => {
    const touching = result.insights.filter(
      (i) => ["packaging_cost", "margin_after_packaging"].includes(i.metric) && (i.period === "2026-02" || i.period === "2026-03"),
    );
    expect(touching).toEqual([]);
    expect(result.openQuestions.some((q) => q.startsWith('Changes in "Packaging cost" around 2026-02 are not reported as findings'))).toBe(
      true,
    );
    // Revenue's findings are untouched.
    expect(result.insights.some((i) => i.metric === "revenue" && i.template === "trend_break.v1" && i.period === "2026-04")).toBe(true);
  });

  it("touchesFlagged also sees a flagged period inside a calc's inputs (a before-mean)", async () => {
    const { touchesFlagged } = await import("../src/quality-guard.ts");
    const f = new Map([["m", { periods: new Set(["2026-02"]), why: "typo" }]]);
    const base = {
      template: "trend_break.v1",
      series: "m",
      metric: "m",
      period: "2026-05",
      direction: "down",
      material: true,
      confidence: "high",
      details: {},
      notes: [],
    } as const;
    const pt = (period: string) => ({ kind: "point", series: "m", period }) as const;
    const clean = {
      ...base,
      roles: { after: pt("2026-05") },
      calcs: [{ name: "mean_before", label: "", value: 1, unit: "currency", fn: "mean", inputs: [pt("2026-03"), pt("2026-04")] }],
    };
    const dirty = {
      ...base,
      roles: { after: pt("2026-05") },
      calcs: [{ name: "mean_before", label: "", value: 1, unit: "currency", fn: "mean", inputs: [pt("2026-01"), pt("2026-02")] }],
    };
    expect(touchesFlagged(clean as never, f)).toBe(false);
    expect(touchesFlagged(dirty as never, f)).toBe(true);
  });
});
