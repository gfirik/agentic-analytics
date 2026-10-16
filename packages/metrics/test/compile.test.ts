// Compiled SQL against hand-computed answers (AGENTS.md §4, metric-layer §4).
import { profileTable } from "@agentic-analytics/profile";
import type { MetricDef } from "@agentic-analytics/schema";
import { loadTable, type NormalizedTable, Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import { compileMetric, loadCatalog, type MetricQuery, runMetric, validateMetrics } from "../src/index.ts";

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});

// Small hand-checkable sales table: Jan, Feb and Apr, two channels, one refund, one total row (ignored).
const SALES: NormalizedTable = {
  id: "T1",
  file_id: "F1",
  sheet: "Sales",
  range: "A1:E7",
  hidden_sheet: false,
  header_rows: [1],
  notes: [],
  transposed: false,
  columns: [
    { name: "day", label: "Date", letter: "A", type: "date" },
    { name: "amount", label: "Amount", letter: "B", type: "currency", currency: "USD" },
    { name: "status", label: "Status", letter: "C", type: "category" },
    { name: "channel", label: "Channel", letter: "D", type: "category" },
    { name: "margin", label: "Margin", letter: "E", type: "percent" },
  ],
  rows: [
    { row: 2, is_total: false, period: "2026-01", values: ["2026-01-05", 10, "paid", "a", 0.2] },
    { row: 3, is_total: false, period: "2026-01", values: ["2026-01-20", 20, "refunded", "b", 0.4] },
    { row: 4, is_total: false, period: "2026-02", values: ["2026-02-03", 30, "paid", "a", 0.1] },
    { row: 5, is_total: false, period: "2026-02", values: ["2026-02-14", 40, "paid", "b", 0.3] },
    { row: 6, is_total: false, period: "2026-04", values: ["2026-04-02", 5, "paid", "a", 0.5] },
    { row: 7, is_total: true, period: null, values: [null, 999, null, null, null] },
  ],
};

const DEFS: MetricDef[] = [
  {
    id: "revenue",
    label: "Revenue",
    type: "sum",
    table: "t_t1",
    expression: "amount",
    filters: ["status <> 'refunded'"],
    unit: "currency",
    currency: "USD",
    status: "assumed",
  },
  {
    id: "refunds",
    label: "Refunds",
    type: "sum",
    table: "t_t1",
    expression: "amount",
    filters: ["status = 'refunded'"],
    unit: "currency",
    currency: "USD",
    status: "assumed",
  },
  { id: "orders", label: "Orders", type: "count", table: "t_t1", unit: "count", status: "assumed" },
  { id: "channels", label: "Channels", type: "count_distinct", table: "t_t1", expression: "channel", unit: "count", status: "assumed" },
  { id: "avg_margin", label: "Average margin", type: "avg", table: "t_t1", expression: "margin", unit: "percent", status: "assumed" },
  {
    id: "refund_rate",
    label: "Refund rate",
    type: "ratio",
    numerator: { table: "t_t1", expression: "amount", filters: ["status = 'refunded'"] },
    denominator: { metric: "revenue" },
    unit: "percent",
    status: "assumed",
  },
  { id: "net", label: "Net", type: "derived", expression: "revenue - refunds", unit: "currency", currency: "USD", status: "assumed" },
];

async function setup() {
  const ws = await Workspace.open();
  open.push(ws);
  await loadTable(ws, SALES);
  await profileTable(ws, SALES, "day");
  const catalog = await loadCatalog(ws);
  const v = validateMetrics(DEFS, catalog);
  expect(v.rejected).toEqual([]);
  return { ws, catalog, defs: v.accepted };
}

const run = async (id: string, query: Partial<MetricQuery> = {}) => {
  const { ws, catalog, defs } = await setup();
  return runMetric(ws, id, defs, catalog, { from: "2026-01", to: "2026-12", ...query });
};

describe("compiled metric SQL (hand-computed)", () => {
  it("sum with a filter, per month; total rows never count", async () => {
    // Jan: paid 10 (the refunded 20 is filtered out); Feb: 30 + 40 = 70; Apr: 5; no March rows
    expect(await run("revenue")).toEqual([
      { period: "2026-01", value: 10 },
      { period: "2026-02", value: 70 },
      { period: "2026-04", value: 5 },
    ]);
  });

  it("count and count_distinct", async () => {
    // Jan: 2 rows, channels a and b; Feb: 2 rows, a and b; Apr: 1 row, a
    expect(await run("orders")).toEqual([
      { period: "2026-01", value: 2 },
      { period: "2026-02", value: 2 },
      { period: "2026-04", value: 1 },
    ]);
    expect((await run("channels")).map((r) => r.value)).toEqual([2, 2, 1]);
  });

  it("avg of a percent column is reported in percentage points", async () => {
    // Jan: (0.2 + 0.4) / 2 = 0.3 → 30; Feb: (0.1 + 0.3) / 2 = 0.2 → 20; Apr: 0.5 → 50
    expect((await run("avg_margin")).map((r) => r.value)).toEqual([expect.closeTo(30, 9), expect.closeTo(20, 9), expect.closeTo(50, 9)]);
  });

  it("ratio: numerator over a referenced metric, ×100 for percent, 0 when there is no numerator", async () => {
    // Jan: refunds 20 / revenue 10 × 100 = 200; Feb: no refunds → 0 / 70 = 0; Apr: 0 / 5 = 0
    expect(await run("refund_rate")).toEqual([
      { period: "2026-01", value: 200 },
      { period: "2026-02", value: 0 },
      { period: "2026-04", value: 0 },
    ]);
  });

  it("derived metrics combine other metrics per period", async () => {
    // Jan: 10 − 20 = −10. Feb: no refund rows, and sums are additive, so refunds are 0: 70 − 0 = 70.
    const rows = await run("net");
    expect(rows.find((r) => r.period === "2026-01")?.value).toBe(-10);
    expect(rows.find((r) => r.period === "2026-02")?.value).toBe(70);
  });

  it("group by a dimension, extra filter, period range and quarter grain", async () => {
    // By channel up to Feb: Jan a = 10 (b's 20 was refunded); Feb a = 30, b = 40
    expect(await run("revenue", { groupBy: ["channel"], to: "2026-02" })).toEqual([
      { period: "2026-01", channel: "a", value: 10 },
      { period: "2026-02", channel: "a", value: 30 },
      { period: "2026-02", channel: "b", value: 40 },
    ]);
    // where channel = 'b': only Feb's 40
    expect(await run("revenue", { where: "channel = 'b'" })).toEqual([{ period: "2026-02", value: 40 }]);
    // Q1 = 10 + 70 = 80; Q2 = 5
    expect(await run("revenue", { grain: "quarter", from: "2026-Q1", to: "2026-Q4" })).toEqual([
      { period: "2026-Q1", value: 80 },
      { period: "2026-Q2", value: 5 },
    ]);
  });

  it("compiles to parameterized SQL: literals never appear in the text", async () => {
    const { catalog, defs } = await setup();
    const q = compileMetric("revenue", defs, catalog, { from: "2026-01", to: "2026-06", where: "channel = 'O''Brien; DROP TABLE x'" });
    expect(q.text).not.toContain("refunded");
    expect(q.text).not.toContain("DROP");
    expect(q.params).toEqual(["refunded", "O'Brien; DROP TABLE x", "2026-01", "2026-06"]);
  });
});
