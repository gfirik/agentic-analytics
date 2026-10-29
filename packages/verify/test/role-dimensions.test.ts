// The concentration pack covers every column of the pack table with an entity or grouping role, not only the dimensions
// the metric is split by (analysis-library §11). On customer-shares-v1 the revenue below is split by channel only, yet the
// customer Pareto facts are stated with the same hand-computed values as when it is split by customer
// (concentration-v2.test.ts), and the customer column adds no member series or member finding, so ranking can't move.

import { type AnalysisResult, analyzeJob } from "@agentic-analytics/analysis";
import { customerSharesCsv, SHARES_TODAY } from "@agentic-analytics/eval-datasets";
import { ingest } from "@agentic-analytics/ingest";
import { loadCatalog, validateMetrics } from "@agentic-analytics/metrics";
import { profileJob } from "@agentic-analytics/profile";
import { Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recomputeFacts } from "../src/index.ts";

let ws: Workspace;
let result: AnalysisResult;

beforeAll(async () => {
  ws = await Workspace.open();
  const summary = await profileJob(ws, await ingest([{ name: "orders.csv", bytes: new TextEncoder().encode(customerSharesCsv()) }]), {
    today: SHARES_TODAY,
  });
  const table = summary.tables[0]?.name as string;
  const catalog = await loadCatalog(ws);
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
        dimensions: ["channel"],
      },
    ],
    catalog,
  );
  expect(v.rejected).toEqual([]);
  result = await analyzeJob(ws, v.accepted, catalog, { from: "2026-01", to: "2026-05", grain: "month" });
}, 120_000);
afterAll(() => ws.close());

const value = (label: string) => {
  const f = result.facts.find((x) => x.label === label);
  if (!f) throw new Error(`no fact ${label}`);
  return f.value;
};

describe("a role column the metric is not split by", () => {
  // Over the five months A totals 318 and B, C and D 94 each; T = 600 (E's −5 and the unkeyed 7 are left out).
  it("is in the concentration section with its Pareto classes, top-N shares and HHI", () => {
    expect(value("pareto.a_count.customer_ttm")).toBe(2);
    expect(value("pareto.a_value.customer_ttm")).toBe(412);
    expect(value("pareto.c_value.customer_ttm")).toBe(94);
    expect(value("pareto.nonpositive_value.customer_ttm")).toBe(-5);
    expect(value("pareto.unkeyed_value.customer_ttm")).toBe(7);
    expect(value("top3_share.customer_ttm")).toBeCloseTo((506 / 600) * 100, 9);
    expect(value("hhi.customer_ttm")).toBeCloseTo((318 ** 2 + 3 * 94 ** 2) / 600 ** 2, 12);
    expect(result.concentration.map((c) => c.dimension)).toEqual(["customer", "channel"]);
  });

  it("states the per-period HHI and its trend: A's share rises every month", () => {
    // 2026-05: A 108, B, C, D 4 each of 120 → (108² + 3·4²) ÷ 120² = 11712 ÷ 14400.
    expect(value("hhi.customer_2026-05")).toBeCloseTo(11712 / 14400, 12);
    expect(value("hhi.customer.trend.slope")).toBeGreaterThan(0);
  });

  it("adds no member findings and no single-customer dependence finding (the customer column is not a split)", () => {
    for (const i of result.insights) expect(i.member?.dimension ?? "channel").toBe("channel");
    expect(result.insights.filter((i) => i.template === "dependence.v1")).toEqual([]);
    expect(result.insights.some((i) => i.template === "concentration.v1" && String(i.details.dimension) === "customer")).toBe(false);
  });

  it("every fact passes V2", async () => {
    const checks = await recomputeFacts(ws, result.facts, new Map(result.facts.map((f) => [f.id, f])));
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  });
});
