// Gross margin drafted by code (analysis-library §9) on the spec's two-product example. Expected values are worked out
// by hand in the comments; nothing is read back from the code under test.
import { describe, expect, it } from "vitest";
import { marginTerms, runMetric, salesKpiPack, validateMetrics } from "../src/index.ts";
import { profiledTable } from "./pack-fixture.ts";

const HEAD = "Date,Product,Qty,Price,Unit cost,Amount";
// Period 0 (January): A 10 × 5 at cost 3, B 10 × 10 at cost 6. Period 1 (February): A 12 × 5 at cost 4, B 8 × 11 at cost 6.
const ROWS = [
  "2026-01-05,A,10,5.00,3.00,50.00",
  "2026-01-06,B,10,10.00,6.00,100.00",
  "2026-02-05,A,12,5.00,4.00,60.00",
  "2026-02-06,B,8,11.00,6.00,88.00",
];
const ROLES = {
  date: "transaction_date",
  product: "product",
  qty: "quantity",
  price: "unit_price",
  unit_cost: "unit_cost",
  amount: "amount",
};

async function drafted(rows = ROWS, roles: Record<string, string> = ROLES, head = HEAD) {
  const { ws, summary, catalog } = await profiledTable(head, rows, roles);
  const pack = salesKpiPack(summary);
  const v = validateMetrics(pack.defs, catalog, { defaultCurrency: "GBP" });
  return { ws, pack, catalog, defs: v.accepted, rejected: v.rejected };
}
const at = async (d: Awaited<ReturnType<typeof drafted>>, id: string, period: string, groupBy?: string[]) =>
  (await runMetric(d.ws, id, d.defs, d.catalog, { from: "2026-01", to: "2026-02", ...(groupBy ? { groupBy } : {}) })).filter(
    (r) => r.period === period,
  );

describe("margin pack", () => {
  it("drafts cost, gross_margin and gross_margin_pct, and the SQL values are the hand-computed ones", async () => {
    const d = await drafted();
    expect(d.rejected).toEqual([]);
    expect(d.defs.map((x) => x.id)).toEqual(expect.arrayContaining(["cost", "gross_margin", "gross_margin_pct"]));
    // January: revenue 50 + 100 = 150; cost 10·3 + 10·6 = 90; margin 60; 60 ÷ 150 = 40%
    expect((await at(d, "cost", "2026-01"))[0]?.value).toBe(90);
    expect((await at(d, "gross_margin", "2026-01"))[0]?.value).toBe(60);
    expect((await at(d, "gross_margin_pct", "2026-01"))[0]?.value).toBeCloseTo(40, 9);
    // February: revenue 60 + 88 = 148; cost 12·4 + 8·6 = 96; margin 52; 52 ÷ 148 × 100 = 35.135135…
    expect((await at(d, "cost", "2026-02"))[0]?.value).toBe(96);
    expect((await at(d, "gross_margin", "2026-02"))[0]?.value).toBe(52);
    expect((await at(d, "gross_margin_pct", "2026-02"))[0]?.value).toBeCloseTo((52 / 148) * 100, 9);
    expect(d.pack.notDrafted.find((n) => n.kpi === "gross_margin")).toBeUndefined();
  });

  it("margin by member: product A earns 12 in February at 20%, product B 40 at 40 ÷ 88 × 100", async () => {
    const d = await drafted();
    const rows = await at(d, "gross_margin", "2026-02", ["product"]);
    expect(Object.fromEntries(rows.map((r) => [r.product, r.value]))).toEqual({ A: 12, B: 40 });
  });

  it("the margin definitions have the fixed shape the fact book and V4 read", async () => {
    const d = await drafted();
    const margin = d.defs.find((x) => x.id === "gross_margin");
    const pct = d.defs.find((x) => x.id === "gross_margin_pct");
    expect(marginTerms(margin as never, d.defs)).toEqual({ fn: "gross_margin", revenue: "revenue", cost: "cost" });
    expect(marginTerms(pct as never, d.defs)).toEqual({ fn: "gross_margin_pct", revenue: "revenue", cost: "cost" });
    expect(marginTerms(d.defs.find((x) => x.id === "revenue") as never, d.defs)).toBeUndefined();
  });

  it("a cost_amount column is summed as it is", async () => {
    const rows = ROWS.map((r, i) => `${r},${[30, 60, 48, 48][i]}`);
    const d = await drafted(rows, { ...ROLES, unit_cost: "none", cost: "cost_amount" }, `${HEAD},Cost`);
    expect(d.pack.defs.find((x) => x.id === "cost")?.expression).toBe("cost");
    expect((await at(d, "gross_margin", "2026-01"))[0]?.value).toBe(60); // 150 − (30 + 60)
  });

  it("lines with no cost are left out of margin on both sides: costed_revenue replaces revenue, with an assumption", async () => {
    const rows = ROWS.map((r, i) => (i === 3 ? r.replace("6.00,88.00", ",88.00") : r));
    const d = await drafted(rows);
    expect(d.rejected).toEqual([]);
    expect(d.pack.defs.find((x) => x.id === "gross_margin")?.expression).toBe("costed_revenue - cost");
    // February without B's line: costed revenue 60, cost 12·4 = 48, margin 12 (not 88 − 0 + 60 − 48 = 100)
    expect((await at(d, "costed_revenue", "2026-02"))[0]?.value).toBe(60);
    expect((await at(d, "gross_margin", "2026-02"))[0]?.value).toBe(12);
    expect((await at(d, "gross_margin_pct", "2026-02"))[0]?.value).toBeCloseTo(20, 9);
    expect(d.pack.assumptions.some((a) => a.metric === "gross_margin")).toBe(true);
  });

  it("a line with no quantity is not costed either: margin covers the costed lines only", async () => {
    // February's B line has no quantity: its revenue (88) must not count, since its cost cannot be computed.
    const rows = ROWS.map((r, i) => (i === 3 ? r.replace(",8,11.00,", ",,11.00,") : r));
    const d = await drafted(rows);
    expect(d.rejected).toEqual([]);
    expect(d.pack.defs.find((x) => x.id === "gross_margin")?.expression).toBe("costed_revenue - cost");
    expect(d.pack.defs.find((x) => x.id === "costed_revenue")?.filters).toEqual(["qty IS NOT NULL", "unit_cost IS NOT NULL"]);
    // A alone: revenue 60, cost 12·4 = 48, margin 12 (not 60 + 88 − 48 = 100)
    expect((await at(d, "gross_margin", "2026-02"))[0]?.value).toBe(12);
    expect(d.pack.assumptions.some((a) => a.metric === "gross_margin")).toBe(true);
  });

  it("without a cost role margin is not drafted and the reason is listed (§13)", async () => {
    const d = await drafted(ROWS, { ...ROLES, unit_cost: "none" });
    expect(d.pack.defs.map((x) => x.id)).not.toContain("gross_margin");
    expect(d.pack.notDrafted).toContainEqual({ kpi: "gross_margin", reason: "no_cost_role" });
  });

  it("a unit cost with no quantity cannot be multiplied: no_quantity_role", async () => {
    const d = await drafted(ROWS, { ...ROLES, qty: "none" });
    expect(d.pack.notDrafted).toContainEqual({ kpi: "gross_margin", reason: "no_quantity_role" });
  });
});
