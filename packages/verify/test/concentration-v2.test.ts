// M15 PR 9: the Pareto and concentration facts, end to end on customer-shares-v1 (evals/datasets/src/customer-shares.ts).
// The expected values are the hand computations written out beside each assertion; V2 recomputes every fact through its
// `pareto_class`, `top_n_share` and `hhi` rules, and the planner's `concentration` tool is held to the confirmed metric
// and dimension.

import { Budget, buildTools, type ToolContext } from "@agentic-analytics/agent";
import { type AnalysisResult, analyzeJob } from "@agentic-analytics/analysis";
import { customerSharesCsv, SHARES_HHI, SHARES_TODAY } from "@agentic-analytics/eval-datasets";
import { ingest } from "@agentic-analytics/ingest";
import { type Catalog, loadCatalog, validateMetrics } from "@agentic-analytics/metrics";
import { profileJob } from "@agentic-analytics/profile";
import type { Fact, MetricDef } from "@agentic-analytics/schema";
import { Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recomputeFacts } from "../src/index.ts";

let ws: Workspace;
let catalog: Catalog;
let defs: MetricDef[];
let result: AnalysisResult;
const range = { from: "2026-01", to: "2026-05", grain: "month" as const };

beforeAll(async () => {
  ws = await Workspace.open();
  const summary = await profileJob(ws, await ingest([{ name: "orders.csv", bytes: new TextEncoder().encode(customerSharesCsv()) }]), {
    today: SHARES_TODAY,
  });
  const table = summary.tables[0]?.name as string;
  catalog = await loadCatalog(ws);
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
        dimensions: ["customer", "channel"],
      },
      { id: "avg_line", label: "Average line", type: "avg", table, expression: "amount", unit: "currency", currency: "USD" },
    ],
    catalog,
  );
  expect(v.rejected).toEqual([]);
  defs = v.accepted;
  result = await analyzeJob(ws, defs, catalog, range);
}, 120_000);
afterAll(() => ws.close());

const byLabel = (label: string): Fact => {
  const f = result.facts.find((x) => x.label === label);
  if (!f) throw new Error(`no fact ${label}`);
  return f;
};
const value = (label: string) => byLabel(label).value;

describe("pareto.v1 and top-N shares on customer-shares-v1", () => {
  // Over the five months A totals 318 (24+42+60+84+108) and B, C and D 94 each (32+26+20+12+4); T = 600.
  it("A = {A, B} (68.67% cumulative), B = {C} (84.33%), C = {D} (100%)", () => {
    expect(value("pareto.a_count.customer_ttm")).toBe(2);
    expect(value("pareto.a_value.customer_ttm")).toBe(412);
    expect(value("pareto.a_share.customer_ttm")).toBeCloseTo((412 / 600) * 100, 9);
    expect(value("pareto.b_count.customer_ttm")).toBe(1);
    expect(value("pareto.b_value.customer_ttm")).toBe(94);
    expect(value("pareto.c_count.customer_ttm")).toBe(1);
    expect(value("pareto.c_value.customer_ttm")).toBe(94);
    expect(value("pareto.members.customer_ttm")).toBe(4);
  });

  it("states what the curve leaves out: E's −5, and 7 on a line with no customer", () => {
    expect(value("pareto.nonpositive_count.customer_ttm")).toBe(1);
    expect(value("pareto.nonpositive_value.customer_ttm")).toBe(-5);
    expect(value("pareto.unkeyed_value.customer_ttm")).toBe(7);
  });

  it("top-1 53%, top-3 (318+94+94)/600 = 84.33%, HHI (318² + 3·94²)/600² = 0.354533; top-5 is not stated with 4 members", () => {
    expect(value("top1_share.customer_ttm")).toBeCloseTo(53, 9);
    expect(value("top3_share.customer_ttm")).toBeCloseTo((506 / 600) * 100, 9);
    expect(value("hhi.customer_ttm")).toBeCloseTo(127632 / 360000, 9);
    expect(result.facts.some((f) => f.label === "top5_share.customer_ttm")).toBe(false);
  });

  it("the latest month: A holds 108 of 120", () => {
    expect(value("top1_share.customer_2026-05")).toBeCloseTo(90, 9);
    expect(value("hhi.customer_2026-05")).toBeCloseTo(11712 / 14400, 9);
    expect(value("top3_share.customer_2026-05")).toBeCloseTo((116 / 120) * 100, 9);
  });

  it("a fact cites the metric's rows in the window", () => {
    const f = byLabel("pareto.a_count.customer_ttm");
    expect(f.computation.kind).toBe("sql");
    expect(f.computation.params?.input_rows).toBe(22);
    expect(f.citations[0]?.rows?.length).toBe(22);
  });

  it("year-before data is missing, which the not-run list says", () => {
    expect(result.notRun.filter((n) => n.analysis === "pareto.v1")).toEqual([
      {
        analysis: "pareto.v1",
        reason_code: "too_few_periods",
        reason: "The data doesn't cover the year before the trailing year, so the classes can't be compared with it.",
        needs: [],
      },
    ]);
    expect(result.facts.some((f) => f.label.endsWith("_ttm_prev"))).toBe(false);
  });
});

describe("the HHI trend", () => {
  // HHI by month: 3648, 3792, 4800, 7488, 11712 (÷ 14400), all rising: S = 10, p = 0.0275. The ten pairwise slopes sorted
  // have 0.1283333 and 0.14 in the middle, so the Theil–Sen slope is 0.1341667.
  it("has slope 0.1341667 per period and p 0.0275", () => {
    expect(SHARES_HHI[4]).toBeCloseTo(0.813333, 6);
    expect(value("hhi.customer.trend.slope")).toBeCloseTo(0.1341667, 6);
    expect(value("hhi.customer.trend.p_value")).toBeCloseTo(0.0275, 4);
  });

  it("and the top-1 share trend slope is 16.6667 percentage points per period (26.67, 35, 50, 70, 90)", () => {
    expect(value("top1_share.customer.trend.slope")).toBeCloseTo(16.6667, 4);
  });
});

describe("dependence.v1 and concentration.v1 use the same facts", () => {
  it("A's share crossed 30% in the year while the HHI rose: a dependence finding citing the trend", () => {
    const dep = result.insights.find((i) => i.template === "dependence.v1");
    expect(dep?.details.dimension).toBe("customer");
    expect(dep?.details.top).toBe("A");
    const id = (role: string) => result.facts.find((f) => f.id === dep?.facts[role]);
    expect(id("top_share")?.label).toBe("top1_share.customer_2026-05");
    expect(id("share_start")?.label).toBe("top1_share.customer_2026-01");
    expect(id("hhi_slope")?.label).toBe("hhi.customer.trend.slope");
  });

  it("concentration.v1 reads the exact shares: A is 90% in May", () => {
    const c = result.insights.find((i) => i.template === "concentration.v1" && i.details.dimension === "customer");
    expect(result.facts.find((f) => f.id === c?.facts.top_share)?.value).toBeCloseTo(90, 9);
    expect(result.facts.find((f) => f.id === c?.facts.hhi)?.value).toBeCloseTo(11712 / 14400, 9);
  });
});

describe("two dimensions in one job", () => {
  it("each has its own labels, and no two facts share one", () => {
    expect(value("pareto.members.channel_ttm")).toBe(2);
    // web is A alone (318); shop is B, C, D (282) plus E (−5) and the line with no customer (7): 284
    expect(value("top1_share.channel_ttm")).toBeCloseTo((318 / 602) * 100, 9);
    const fixed = result.facts.map((f) => f.label).filter((l) => /^(pareto\.|top\d+_share\.|hhi\.)/.test(l));
    expect(new Set(fixed).size).toBe(fixed.length);
  });
});

describe("V2", () => {
  const all = () => new Map(result.facts.map((f) => [f.id, f]));

  it("recomputes every fact of the job, the class counts, shares and HHI from the members' totals", async () => {
    const checks = await recomputeFacts(ws, result.facts, all());
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.some((c) => c.how.startsWith("pareto_class"))).toBe(true);
    expect(checks.some((c) => c.how.startsWith("top_n_share"))).toBe(true);
    expect(checks.some((c) => c.how.startsWith("hhi"))).toBe(true);
  });

  it("refuses a class count, a share and an HHI that was changed", async () => {
    for (const label of ["pareto.a_count.customer_ttm", "top3_share.customer_ttm", "hhi.customer_ttm"]) {
      const f = byLabel(label);
      const [r] = await recomputeFacts(ws, [{ ...f, value: f.value + 1 }], all());
      expect(r?.ok, label).toBe(false);
    }
  });

  it("refuses a statistic whose template says another number than the members give", async () => {
    // The SQL still returns 2 for A's count, so a fact that claims the HHI's template computes 2 for the HHI is a mismatch.
    const f = byLabel("hhi.customer_ttm");
    const a = byLabel("pareto.a_count.customer_ttm");
    const [r] = await recomputeFacts(ws, [{ ...f, computation: { ...f.computation, sql: a.computation.sql } }], all());
    expect(r?.ok).toBe(false);
  });
});

describe("the concentration planner tool", () => {
  const tools = () =>
    buildTools(
      { ws, defs, catalog, range, found: { extracts: [], quarantined: [], questions: [], scenarios: [] } } as unknown as ToolContext,
      new Budget(50, 50),
    );
  const call = (input: Record<string, string>) =>
    (tools().concentration as unknown as { execute(i: unknown): Promise<Record<string, unknown>> }).execute(input);

  it("answers for a range with labelled facts", async () => {
    const r = await call({ metric_id: "revenue", dimension: "customer", from: "2026-02", to: "2026-04" });
    const facts = r.facts as Record<string, { value: number; label: string }>;
    // Feb–Apr: A = 42+60+84 = 186; B, C, D = 26+20+12 = 58 each; T = 360
    expect(facts.top1_share?.label).toBe("top1_share.customer_2026-02_2026-04");
    expect(facts.top1_share?.value).toBeCloseTo((186 / 360) * 100, 4);
    expect(facts.top3_share?.value).toBeCloseTo((302 / 360) * 100, 4);
    expect(facts.members?.value).toBe(4);
  });

  it("names a calendar year by its year, and one period by itself, and does not make a second fact for a repeated call", async () => {
    const one = await call({ metric_id: "revenue", dimension: "customer", from: "2026-03", to: "2026-03" });
    expect((one.facts as Record<string, { label: string }>).hhi?.label).toBe("hhi.customer_2026-03");
    const before = (await ws.all<{ id: string }>({ text: "SELECT id FROM facts", params: [] })).length;
    await call({ metric_id: "revenue", dimension: "customer", from: "2026-03", to: "2026-03" });
    expect((await ws.all<{ id: string }>({ text: "SELECT id FROM facts", params: [] })).length).toBe(before);
  });

  it("refuses a dimension that is not a confirmed dimension of the metric", async () => {
    const r = await call({ metric_id: "revenue", dimension: "amount", from: "2026-01", to: "2026-05" });
    expect(String(r.error)).toContain("UNKNOWN_DIMENSION");
    const injected = await call({ metric_id: "revenue", dimension: 'customer"; DROP TABLE facts; --', from: "2026-01", to: "2026-05" });
    expect(String(injected.error)).toContain("UNKNOWN_DIMENSION");
  });

  it("refuses a metric that is not additive, an unknown metric and periods that are not job periods", async () => {
    expect(String((await call({ metric_id: "avg_line", dimension: "customer", from: "2026-01", to: "2026-05" })).error)).toContain(
      "NOT_ADDITIVE",
    );
    expect(String((await call({ metric_id: "nope", dimension: "customer", from: "2026-01", to: "2026-05" })).error)).toContain(
      "UNKNOWN_METRIC",
    );
    for (const [from, to] of [
      ["2026-13", "2026-05"],
      ["2026-1", "2026-05"],
      ["2025-12", "2026-05"],
      ["2026-01", "2026-06"],
      ["2026-04", "2026-02"],
      ["2026-01'; --", "2026-05"],
    ])
      expect(
        String((await call({ metric_id: "revenue", dimension: "customer", from: from as string, to: to as string })).error),
        `${from} ${to}`,
      ).toContain("BAD_PERIOD");
  });
});
