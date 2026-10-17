// The same CTE on both sides of a join (metric-layer §4). construction_supplier-v1 failed in a real-model eval with
// `Binder Error: Ambiguous reference to table "m1" (duplicate alias "m1")`: a drafted ratio whose numerator and
// denominator were the same metric compiled to `FROM m1 FULL JOIN m1`. Each join side now gets its own alias, and
// validation rejects such self-ratios (always 1) before they reach the compiler.
import { profileTable } from "@agentic-analytics/profile";
import type { MetricDef } from "@agentic-analytics/schema";
import { loadTable, type NormalizedTable, Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import { compileMetric, loadCatalog, runMetric, validateMetrics } from "../src/index.ts";

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});

// Jan: 10 (a) + 20 (b, refunded); Feb: 30 (a) + 40 (b); Apr: 5 (a).
const SALES: NormalizedTable = {
  id: "T1",
  file_id: "F1",
  sheet: "Sales",
  range: "A1:D6",
  hidden_sheet: false,
  header_rows: [1],
  notes: [],
  transposed: false,
  columns: [
    { name: "day", label: "Date", letter: "A", type: "date" },
    { name: "amount", label: "Amount", letter: "B", type: "currency", currency: "USD" },
    { name: "status", label: "Status", letter: "C", type: "category" },
    { name: "channel", label: "Channel", letter: "D", type: "category" },
  ],
  rows: [
    { row: 2, is_total: false, period: "2026-01", values: ["2026-01-05", 10, "paid", "a"] },
    { row: 3, is_total: false, period: "2026-01", values: ["2026-01-20", 20, "refunded", "b"] },
    { row: 4, is_total: false, period: "2026-02", values: ["2026-02-03", 30, "paid", "a"] },
    { row: 5, is_total: false, period: "2026-02", values: ["2026-02-14", 40, "paid", "b"] },
    { row: 6, is_total: false, period: "2026-04", values: ["2026-04-02", 5, "paid", "a"] },
  ],
};

const REVENUE: MetricDef = {
  id: "revenue",
  label: "Revenue",
  type: "sum",
  table: "t_t1",
  expression: "amount",
  filters: ["status <> 'refunded'"],
  unit: "currency",
  currency: "USD",
  status: "assumed",
};

// What a model can draft: a "ratio" of revenue to itself. Validation rejects it; the compiler must still emit valid SQL.
const SELF_RATIO: MetricDef = {
  id: "revenue_share",
  label: "Revenue share",
  type: "ratio",
  numerator: { metric: "revenue" },
  denominator: { metric: "revenue" },
  unit: "ratio",
  status: "assumed",
};

async function setup() {
  const ws = await Workspace.open();
  open.push(ws);
  await loadTable(ws, SALES);
  await profileTable(ws, SALES, "day");
  return { ws, catalog: await loadCatalog(ws) };
}

describe("a CTE joined to itself", () => {
  it("runs a ratio whose two sides are the same metric (each side has its own alias)", async () => {
    const { ws, catalog } = await setup();
    const defs = [REVENUE, SELF_RATIO];
    // Revenue per month: Jan 10, Feb 70, Apr 5, so revenue / revenue is 1 in every month that has revenue.
    expect(await runMetric(ws, "revenue_share", defs, catalog, { from: "2026-01", to: "2026-12" })).toEqual([
      { period: "2026-01", value: 1 },
      { period: "2026-02", value: 1 },
      { period: "2026-04", value: 1 },
    ]);
    // By channel: Jan a 10/10; Feb a 30/30, b 40/40; Apr a 5/5 (Jan b only has a refunded row: no revenue).
    expect(await runMetric(ws, "revenue_share", defs, catalog, { from: "2026-01", to: "2026-12", groupBy: ["channel"] })).toEqual([
      { period: "2026-01", channel: "a", value: 1 },
      { period: "2026-02", channel: "a", value: 1 },
      { period: "2026-02", channel: "b", value: 1 },
      { period: "2026-04", channel: "a", value: 1 },
    ]);
    const { text } = compileMetric("revenue_share", defs, catalog, { from: "2026-01", to: "2026-12" });
    expect(text).toContain("FROM m1 AS j0 FULL JOIN m1 AS j1");
  });

  it("runs a derived metric over a self-ratio and another metric", async () => {
    const { ws, catalog } = await setup();
    const defs: MetricDef[] = [
      REVENUE,
      SELF_RATIO,
      {
        id: "scaled",
        label: "Scaled",
        type: "derived",
        expression: "revenue * revenue_share",
        unit: "currency",
        currency: "USD",
        status: "assumed",
      },
    ];
    // revenue × 1: Jan 10, Feb 70, Apr 5.
    expect((await runMetric(ws, "scaled", defs, catalog, { from: "2026-01", to: "2026-12" })).map((r) => r.value)).toEqual([10, 70, 5]);
  });
});

describe("validation rejects a ratio that divides a quantity by itself", () => {
  it("same metric on both sides", async () => {
    const { catalog } = await setup();
    const v = validateMetrics([REVENUE, SELF_RATIO], catalog);
    expect(v.accepted.map((m) => m.id)).toEqual(["revenue"]);
    expect(v.rejected).toEqual([
      expect.objectContaining({ id: "revenue_share", reasons: ['ratio "revenue_share" divides "revenue" by itself (always 1)'] }),
    ]);
  });

  it("same table, expression and filters on both sides", async () => {
    const { catalog } = await setup();
    const term = { table: "t_t1", expression: "amount", filters: ["status <> 'refunded'"] };
    const v = validateMetrics(
      [
        {
          id: "x",
          label: "X",
          type: "ratio",
          numerator: term,
          denominator: { ...term, filters: [" status <> 'refunded' "] },
          unit: "percent",
        },
      ],
      catalog,
    );
    expect(v.accepted).toEqual([]);
    expect(v.rejected[0]?.reasons).toEqual(['ratio "x" divides "sum(amount) of t_t1 where status <> \'refunded\'" by itself (always 1)']);
  });

  it("a table term equal to the metric on the other side", async () => {
    const { catalog } = await setup();
    const v = validateMetrics(
      [
        REVENUE,
        {
          id: "y",
          label: "Y",
          type: "ratio",
          numerator: { table: "t_t1", expression: "amount", filters: ["status <> 'refunded'"] },
          denominator: { metric: "revenue" },
          unit: "percent",
        },
      ],
      catalog,
    );
    expect(v.rejected.map((r) => r.reasons)).toEqual([['ratio "y" divides "revenue" by itself (always 1)']]);
  });

  it("different filters on the two sides are a real ratio", async () => {
    const { catalog } = await setup();
    const v = validateMetrics(
      [
        REVENUE,
        {
          id: "refund_rate",
          label: "Refund rate",
          type: "ratio",
          numerator: { table: "t_t1", expression: "amount", filters: ["status = 'refunded'"] },
          denominator: { metric: "revenue" },
          unit: "percent",
        },
      ],
      catalog,
    );
    expect(v.rejected).toEqual([]);
  });
});
