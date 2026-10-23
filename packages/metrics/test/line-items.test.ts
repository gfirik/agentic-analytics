// The offline fallback on an invoice-line table with no amount column (Online Retail II's shape, evals/real):
// revenue is drafted as quantity × unit price. Expected values are hand-computed from the ten lines below.
import { ingest } from "@agentic-analytics/ingest";
import { profileJob } from "@agentic-analytics/profile";
import { Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import { describeMetric, fallbackMetrics, loadCatalog, runMetric, validateMetrics } from "../src/index.ts";

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});

const LINES = `Invoice,StockCode,Quantity,InvoiceDate,Price,Customer ID,Country
1001,A,2,2026-01-05 10:00:00,1.50,11,UK
1001,B,1,2026-01-05 10:00:00,4.00,11,UK
1002,A,4,2026-01-12 11:00:00,1.50,12,France
C1003,A,-1,2026-01-20 09:00:00,1.50,11,UK
1004,B,3,2026-01-28 12:00:00,4.00,,UK
1005,A,10,2026-02-03 12:00:00,1.25,12,UK
1005,B,2,2026-02-03 12:00:00,4.00,12,UK
1006,A,1,2026-02-14 08:00:00,1.50,,France
1007,B,5,2026-02-21 15:00:00,4.00,13,UK
1008,A,-2,2026-02-27 16:00:00,1.50,13,UK
`;

describe("fallback metrics on invoice lines", () => {
  it("drafts revenue as quantity × price and orders as distinct invoices", async () => {
    const ws = await Workspace.open();
    open.push(ws);
    const summary = await profileJob(ws, await ingest([{ name: "lines.csv", bytes: new TextEncoder().encode(LINES) }]), {
      today: "2026-07-01",
    });
    const catalog = await loadCatalog(ws);
    const v = validateMetrics(fallbackMetrics(summary), catalog, { defaultCurrency: "GBP" });
    expect(v.rejected).toEqual([]);
    const defs = v.accepted;
    expect(defs.map((d) => [d.id, d.type, d.expression])).toEqual([
      ["revenue", "sum", "quantity * price"],
      ["orders", "count_distinct", "invoice"],
    ]);
    expect(describeMetric(defs[0] as (typeof defs)[number])).toBe("Revenue = sum of quantity × price, per month, in GBP (assumed)");
    // January: 2×1.50 + 1×4.00 + 4×1.50 − 1×1.50 + 3×4.00 = 23.50; February: 10×1.25 + 2×4.00 + 1×1.50 + 5×4.00 − 2×1.50 = 39.00
    expect(await runMetric(ws, "revenue", defs, catalog, { from: "2026-01", to: "2026-02" })).toEqual([
      { period: "2026-01", value: 23.5 },
      { period: "2026-02", value: 39 },
    ]);
    // January: 1001, 1002, C1003, 1004; February: 1005, 1006, 1007, 1008
    expect(await runMetric(ws, "orders", defs, catalog, { from: "2026-01", to: "2026-02" })).toEqual([
      { period: "2026-01", value: 4 },
      { period: "2026-02", value: 4 },
    ]);
  });

  it("prefers a money-named amount column when there is one", async () => {
    const ws = await Workspace.open();
    open.push(ws);
    const text = "Date,Qty,Price,Amount\n2026-01-05,2,1.50,3.00\n2026-01-06,1,4.00,4.00\n2026-01-07,3,1.50,4.50\n2026-02-02,1,4.00,4.00\n";
    const summary = await profileJob(ws, await ingest([{ name: "s.csv", bytes: new TextEncoder().encode(text) }]), { today: "2026-07-01" });
    expect(fallbackMetrics(summary).find((d) => d.id === "revenue")?.expression).toBe("amount");
  });
});

describe("fallback metrics read column roles, not header names (semantics §1)", () => {
  const CSV = "Date,Foo,Route\n2026-01-05,$3.00,a\n2026-01-06,$4.00,b\n2026-01-07,$4.50,a\n2026-02-02,$4.00,b\n2026-02-09,$5.00,a\n";
  const withRoles = async (assign: Record<string, string>) => {
    const ws = await Workspace.open();
    open.push(ws);
    const summary = await profileJob(ws, await ingest([{ name: "s.csv", bytes: new TextEncoder().encode(CSV) }]), { today: "2026-07-01" });
    const first = summary.semantics.roles[0];
    if (!first) throw new Error("no roles");
    const columns = first.columns.map((c) => ({ ...c, role: (assign[c.column] ?? "none") as typeof c.role, score: 1 }));
    return { ...summary, semantics: { ...summary.semantics, roles: [{ ...first, columns }] } };
  };

  it("a column the roles call the amount is revenue, whatever its header says; the channel role splits it", async () => {
    const summary = await withRoles({ date: "transaction_date", foo: "amount", route: "channel" });
    const drafts = fallbackMetrics(summary);
    expect(drafts.map((d) => [d.id, d.expression])).toEqual([
      ["revenue", "foo"],
      ["a_revenue", "foo"],
      ["b_revenue", "foo"],
    ]);
  });

  it("with no amount role there is no revenue to draft: the header 'Foo' alone is not enough, and neither would 'Amount' be", async () => {
    expect(fallbackMetrics(await withRoles({ date: "transaction_date", route: "channel" }))).toEqual([]);
  });

  it("a summary with no roles drafts nothing", async () => {
    const summary = await withRoles({ foo: "amount" });
    expect(fallbackMetrics({ ...summary, semantics: { ...summary.semantics, roles: [] } })).toEqual([]);
  });
});
