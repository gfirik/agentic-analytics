import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingest, type TableRegion } from "@agentic-analytics/ingest";
import { describe, expect, it } from "vitest";
import { normalizeTable, periodOf } from "../src/index.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const tablesOf = async (...paths: string[]) =>
  (await ingest(paths.map((p) => ({ name: p.split("/").pop() ?? p, bytes: new Uint8Array(readFileSync(join(root, p))) })))).tables;
const types = (t: TableRegion) => {
  const n = normalizeTable(t).table;
  return Object.fromEntries(n.columns.map((c) => [c.name, c.currency ? `${c.type}:${c.currency}` : c.type]));
};

describe("normalizeTable", () => {
  it("coffee-roaster Orders: dd/mm text dates resolved day-first, ambiguity reported, types inferred", async () => {
    const [orders] = await tablesOf("evals/datasets/coffee-roaster-v1/files/sales-2026.xlsx");
    if (!orders) throw new Error("no table");
    const res = normalizeTable(orders);
    expect(types(orders)).toEqual({
      date: "date",
      order_id: "id",
      customer: "category",
      channel: "category",
      product: "category",
      qty: "integer",
      amount: "currency",
      status: "category",
    });
    const first = res.table.rows[0];
    expect(first?.values[0]).toBe("2026-01-01");
    expect(first?.period).toBe("2026-01");
    expect(res.periodColumn).toBe("date");
    const ambiguity = res.issues.find((i) => i.kind === "date_format_ambiguity");
    expect(ambiguity).toMatchObject({ severity: "low", column: "date", letter: "A" });
    expect(ambiguity?.details).toMatchObject({ order: "dmy", assumed: false });
    // A row dated 13 March or later only fits day-first, so the order is decided, not assumed.
    const row = res.table.rows.find((r) => r.values[0] === "2026-03-13");
    expect(row?.period).toBe("2026-03");
  });

  it("coffee-roaster Monthly: month dates, money by header, percent by number format", async () => {
    const [, monthly, costs] = await tablesOf("evals/datasets/coffee-roaster-v1/files/sales-2026.xlsx");
    if (!monthly || !costs) throw new Error("no table");
    expect(types(monthly)).toEqual({ month: "date", revenue: "currency", orders: "integer", wholesale: "integer", retail: "integer", refund_rate: "percent" });
    const n = normalizeTable(monthly).table;
    // March row: Revenue 44,100 and Refund rate 1.2% stored as the fraction 0.012
    expect(n.rows[2]?.values).toEqual(["2026-03-01", 44100, 1050, 15900, 28200, 0.012]);
    expect(types(costs)).toEqual({ month: "date", beans: "integer", packaging: "integer", rent: "integer", staff: "integer" });
  });

  it("semicolon CSV: decimal commas and an all-ambiguous dd.mm column become an assumption", async () => {
    const [t] = await tablesOf("fixtures/csv/01-semicolon.csv");
    if (!t) throw new Error("no table");
    const res = normalizeTable(t);
    expect(types(t)).toEqual({ date: "date", customer: "category", amount: "currency", note: "text" });
    // "1 234,50" → 1234.5; "980,00" → 980; "1 050,25" → 1050.25
    expect(res.table.rows.map((r) => r.values[2])).toEqual([1234.5, 980, 1050.25]);
    expect(res.table.rows.map((r) => r.values[0])).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
    expect(res.issues.find((i) => i.kind === "date_format_ambiguity")).toMatchObject({ severity: "medium", details: { assumed: true } });
  });

  it("Cyrillic headers get transliterated names and keep their labels", async () => {
    const [t] = await tablesOf("fixtures/xlsx/12-russian.xlsx");
    if (!t) throw new Error("no table");
    const n = normalizeTable(t).table;
    expect(n.columns.map((c) => [c.name, c.label, c.type])).toEqual([
      ["tovar", "Товар", "category"],
      ["kolichestvo", "Количество", "integer"],
      ["summa", "Сумма", "currency"],
    ]);
    expect(n.rows.at(-1)).toMatchObject({ is_total: true, values: ["Итого", 17, 1350] });
  });

  it("flags mixed currencies and never converts", () => {
    const t: TableRegion = {
      id: "T9",
      file_id: "F1",
      hidden_sheet: false,
      range: "A1:B5",
      header_rows: [1],
      columns: [
        { name: "Client", letter: "A" },
        { name: "Paid", letter: "B" },
      ],
      rows: [
        ["Acme", "$1,200"],
        ["Beta", "900 сум"],
        ["Gamma", "$300"],
        ["Delta", "$40"],
      ].map(([a, b], i) => ({ row: i + 2, is_total: false, cells: [{ v: a ?? "", t: "s" as const }, { v: b ?? "", t: "s" as const }] })),
      transposed: false,
      notes: [],
    };
    const res = normalizeTable(t);
    expect(res.issues.map((i) => [i.kind, i.severity, i.details?.currencies])).toEqual([["mixed_currency", "high", ["USD", "UZS"]]]);
    expect(res.table.rows.map((r) => r.values[1])).toEqual([1200, 900, 300, 40]);
  });
});

describe("periodOf (job grain)", () => {
  it.each([
    ["2026-03-15", "day", "2026-03-15"],
    ["2026-03-15", "month", "2026-03"],
    ["2026-03-15", "quarter", "2026-Q1"],
    ["2026-03-15", "year", "2026"],
    ["2026-01-01", "week", "2026-W01"], // Thursday 2026-01-01 is in ISO week 1 of 2026
    ["2027-01-01", "week", "2026-W53"], // Friday 2027-01-01 belongs to the last ISO week of 2026 (2026 has 53)
  ] as const)("%s at %s → %s", (iso, grain, expected) => {
    expect(periodOf(iso, grain)).toBe(expected);
  });
});
