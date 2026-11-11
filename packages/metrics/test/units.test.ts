// Backtest pre-tag 2: the scale and currency a money column's header states reach the metric definition
// (metric-layer §2.3, ingestion-and-profiling §6). Values are never multiplied; unit words only name them.
import { profileTable } from "@agentic-analytics/profile";
import type { MetricDef } from "@agentic-analytics/schema";
import { loadTable, type NormalizedTable, Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import { describeMetric, loadCatalog, validateMetrics } from "../src/index.ts";

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});

async function catalogFor(label: string, name: string, extra: { currency?: string } = {}) {
  const table: NormalizedTable = {
    id: "T1",
    file_id: "F1",
    range: "A1:B3",
    hidden_sheet: false,
    header_rows: [1],
    notes: [],
    transposed: false,
    columns: [
      { name: "day", label: "Date", letter: "A", type: "date" },
      { name: name, label: label, letter: "B", type: "currency", ...extra },
    ],
    rows: [
      { row: 2, is_total: false, period: "2026-01", values: ["2026-01-02", 10] },
      { row: 3, is_total: false, period: "2026-02", values: ["2026-02-02", 20] },
    ],
  };
  const ws = await Workspace.open();
  open.push(ws);
  await loadTable(ws, table);
  await profileTable(ws, table, "day");
  return loadCatalog(ws);
}

const metric = (column: string) => ({ id: "revenue", label: "Revenue", type: "sum", table: "t_t1", expression: column, unit: "currency" });

describe("scale and currency words in a money header", () => {
  it("amount_mln_uzs: scale million, currency UZS, no job currency needed and no 'unknown currency' assumption", async () => {
    const catalog = await catalogFor("amount_mln_uzs", "amount_mln_uzs");
    const v = validateMetrics([metric("amount_mln_uzs")], catalog);
    expect(v.rejected).toEqual([]);
    expect(v.accepted[0]).toMatchObject({ scale: "million", currency: "UZS" });
    expect(v.assumptions).toEqual([]);
    expect(describeMetric(v.accepted[0] as MetricDef)).toContain("in million UZS");
  });

  it("a header currency is only a fallback: a currency marked in the column wins, and --currency fills the rest", async () => {
    const marked = await catalogFor("Revenue (USD mn)", "revenue_usd_mn", { currency: "EUR" });
    expect(validateMetrics([metric("revenue_usd_mn")], marked).accepted[0]).toMatchObject({ scale: "million", currency: "EUR" });
    const plain = await catalogFor("Amount thousand", "amount_thousand");
    expect(validateMetrics([metric("amount_thousand")], plain, { defaultCurrency: "USD" }).accepted[0]).toMatchObject({
      scale: "thousand",
      currency: "USD",
    });
  });

  it("no scale word: no scale (kg, monthly and bank never match)", async () => {
    for (const name of ["weight_kg", "monthly_total", "bank_amount"]) {
      const catalog = await catalogFor(name, name);
      const def = validateMetrics([metric(name)], catalog, { defaultCurrency: "USD" }).accepted[0];
      expect(def?.scale, name).toBeUndefined();
    }
  });

  it("a scale the proposal states is kept; counts and percentages never get one", async () => {
    const catalog = await catalogFor("amount_mln", "amount_mln");
    const v = validateMetrics(
      [
        { ...metric("amount_mln"), scale: "billion" },
        { id: "orders", label: "Orders", type: "count", table: "t_t1", unit: "count" },
      ],
      catalog,
      { defaultCurrency: "USD" },
    );
    expect(v.accepted.find((m) => m.id === "revenue")?.scale).toBe("billion");
    expect(v.accepted.find((m) => m.id === "orders")?.scale).toBeUndefined();
  });

  it("a currency of unknown code with a scale reads as 'currency unknown, in millions'", () => {
    const def = {
      id: "r",
      label: "R",
      type: "sum",
      table: "t",
      expression: "a",
      unit: "currency",
      currency: "XXX",
      scale: "million",
      status: "assumed",
    } as MetricDef;
    expect(describeMetric(def)).toContain("currency unknown, in millions");
  });
});
