// The sales KPI pack (analysis-library §8.1) on the spec's 10-line fixture (§8.2), plus one earlier month in which C1 and
// C6 bought. Every expected value is worked out by hand in the comments; nothing is read back from the code under test.
import { ingest } from "@agentic-analytics/ingest";
import { profileJob } from "@agentic-analytics/profile";
import { Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import { draftMetrics, loadCatalog, mergeMetricSets, runMetric, salesKpiPack, sliceParents, validateMetrics } from "../src/index.ts";

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});

const HEAD = "Date,Order,Customer,Product,Qty,Price,Discount,Amount,Status";
// December: C1 and C6 each bought once (200.00 in all). January: the spec's ten lines (lines 5 and 8 refunded).
const ROWS = [
  "2025-12-10,D1,C1,A,1,100.00,0,100.00,paid",
  "2025-12-12,D2,C6,A,1,100.00,0,100.00,paid",
  "2026-01-03,O1,C1,A,2,100.00,0,200.00,paid",
  "2026-01-03,O1,C1,B,1,150.00,0,150.00,paid",
  "2026-01-05,O2,C2,A,3,100.00,0,300.00,paid",
  "2026-01-07,O3,C1,B,2,150.00,0,300.00,paid",
  "2026-01-09,O4,C3,A,1,100.00,0,100.00,refunded",
  "2026-01-12,O5,C4,C,4,50.00,20.00,180.00,paid",
  "2026-01-15,O6,C2,D,5,85.00,0,425.00,paid",
  "2026-01-18,O7,C5,B,1,150.00,0,150.00,refunded",
  "2026-01-21,O8,C3,B,2,150.00,30.00,270.00,paid",
  "2026-01-21,O8,C3,C,1,50.00,0,50.00,paid",
];
const ROLES: Record<string, string> = {
  date: "transaction_date",
  order: "order_id",
  customer: "customer_id",
  product: "product",
  qty: "quantity",
  price: "unit_price",
  discount: "discount",
  amount: "amount",
  status: "status",
};

async function setup(head = HEAD, rows = ROWS, roles = ROLES, kind = "sales_lines") {
  const ws = await Workspace.open();
  open.push(ws);
  const text = `${head}\n${rows.join("\n")}\n`;
  const summary = await profileJob(ws, await ingest([{ name: "s.csv", bytes: new TextEncoder().encode(text) }]), { today: "2026-07-01" });
  const first = summary.semantics.roles[0];
  if (!first) throw new Error("no roles");
  const columns = first.columns.map((c) => ({ ...c, role: (roles[c.column] ?? "none") as typeof c.role, score: 1 }));
  const table_kinds = summary.semantics.table_kinds.map((k) => ({ ...k, kind: kind as typeof k.kind }));
  const withRoles = { ...summary, semantics: { ...summary.semantics, roles: [{ ...first, columns }], table_kinds } };
  return { ws, summary: withRoles, catalog: await loadCatalog(ws) };
}

const value = async (
  ws: Workspace,
  id: string,
  defs: Parameters<typeof runMetric>[2],
  catalog: Parameters<typeof runMetric>[3],
  period: string,
) => (await runMetric(ws, id, defs, catalog, { from: "2025-12", to: "2026-01" })).find((r) => r.period === period)?.value;

describe("sales KPI pack on the 10-line fixture", () => {
  it("drafts every KPI whose roles exist, and the values are the hand-computed ones", async () => {
    const { ws, summary, catalog } = await setup();
    const v = validateMetrics(salesKpiPack(summary).defs, catalog, { defaultCurrency: "USD" });
    expect(v.rejected).toEqual([]);
    const defs = v.accepted;
    expect(defs.map((d) => d.id).sort()).toEqual(
      ["aov", "customers", "new_customers", "orders", "refund_rate", "returning_customers", "revenue", "units", "discount_rate"].sort(),
    );
    const at = (id: string) => value(ws, id, defs, catalog, "2026-01");
    // revenue lines are 1–4, 6, 7, 9, 10 of January's ten: 200 + 150 + 300 + 300 + 180 + 425 + 270 + 50 = 1,875
    expect(await at("revenue")).toBeCloseTo(1875, 9);
    // distinct orders over those lines: O1, O2, O3, O5, O6, O8
    expect(await at("orders")).toBe(6);
    // 1,875 ÷ 6 = 312.50
    expect(await at("aov")).toBeCloseTo(312.5, 9);
    // 2 + 1 + 3 + 2 + 4 + 5 + 2 + 1 = 20
    expect(await at("units")).toBe(20);
    // C1, C2, C3 (through O8), C4; C5 has only a refunded order
    expect(await at("customers")).toBe(4);
    // refunded lines 5 and 8 are worth 100 + 150 = 250; 250 ÷ 1,875 × 100 = 13.3333…
    expect(await at("refund_rate")).toBeCloseTo((250 / 1875) * 100, 9);
    // discounts 20 + 30 = 50; gross = 200 + 150 + 300 + 300 + 200 + 425 + 300 + 50 = 1,925; 50 ÷ 1,925 × 100 = 2.5974025…
    expect(await at("discount_rate")).toBeCloseTo((50 / 1925) * 100, 9);
    // December bought C1 and C6: in January C1 is returning (1); C2, C3 and C4 are new (3)
    expect(await at("returning_customers")).toBe(1);
    expect(await at("new_customers")).toBe(3);
    // the table's first month has no history: new and returning are not stated for it, customers are
    expect(await value(ws, "new_customers", defs, catalog, "2025-12")).toBeUndefined();
    expect(await value(ws, "returning_customers", defs, catalog, "2025-12")).toBeUndefined();
    expect(await value(ws, "customers", defs, catalog, "2025-12")).toBe(2);
  });

  it("lists what it could not draft, with the reason (cancellation: no cancel status in this table)", async () => {
    const { summary } = await setup();
    expect(salesKpiPack(summary).notDrafted).toEqual([{ kpi: "cancellation_rate", reason: "no_status_role" }]);
  });

  it("a missing role means that KPI is not drafted and is listed: no customer, quantity, discount, status or order id", async () => {
    const { summary } = await setup(HEAD, ROWS, { date: "transaction_date", price: "unit_price", amount: "amount" });
    const pack = salesKpiPack(summary);
    expect(pack.defs.map((d) => d.id)).toEqual(["revenue"]);
    expect(pack.notDrafted).toEqual([
      { kpi: "orders", reason: "no_order_id" },
      { kpi: "units", reason: "no_quantity_role" },
      { kpi: "aov", reason: "no_order_id" },
      { kpi: "customers", reason: "no_customer_role" },
      { kpi: "new_customers", reason: "no_customer_role" },
      { kpi: "returning_customers", reason: "no_customer_role" },
      { kpi: "refund_rate", reason: "no_refund_role" },
      { kpi: "cancellation_rate", reason: "no_status_role" },
      { kpi: "discount_rate", reason: "no_discount_role" },
    ]);
  });

  it("with no amount role revenue is quantity × unit price, and discount rate falls back to amount + discount only without a price", async () => {
    const { summary } = await setup(HEAD, ROWS, { ...ROLES, amount: "none" });
    const pack = salesKpiPack(summary);
    expect(pack.defs.find((d) => d.id === "revenue")?.expression).toBe("qty * price");
    expect(pack.defs.find((d) => d.id === "discount_rate")?.denominator).toMatchObject({ expression: "qty * price" });
    const noPrice = salesKpiPack((await setup(HEAD, ROWS, { ...ROLES, price: "none" })).summary);
    expect(noPrice.defs.find((d) => d.id === "discount_rate")?.denominator).toMatchObject({ expression: "amount + discount" });
    expect(noPrice.assumptions[0]?.text).toContain("net of discount");
  });

  it("with refund_amount the refund rate is Σ refund_amount ÷ revenue × 100", async () => {
    const head = `${HEAD},Refund`;
    const rows = ROWS.map((r, i) => `${r},${i === 6 ? "100.00" : i === 9 ? "150.00" : ""}`);
    const { ws, summary, catalog } = await setup(head, rows, { ...ROLES, status: "none", refund: "refund_amount" });
    const defs = validateMetrics(salesKpiPack(summary).defs, catalog, { defaultCurrency: "USD" }).accepted;
    // no status: revenue lines are all of January's ten, 1,875 + 100 + 150 = 2,125; refunded money 100 + 150 = 250; 250 ÷ 2,125 × 100 = 11.7647…
    expect(await value(ws, "refund_rate", defs, catalog, "2026-01")).toBeCloseTo((250 / 2125) * 100, 9);
  });

  it("cancelled lines leave revenue and the cancellation rate counts distinct orders", async () => {
    const rows = ROWS.map((r) => r.replace("O7,C5,B,1,150.00,0,150.00,refunded", "O7,C5,B,1,150.00,0,150.00,cancelled"));
    const { ws, summary, catalog } = await setup(HEAD, rows);
    const pack = salesKpiPack(summary);
    expect(pack.notDrafted).toEqual([]);
    const defs = validateMetrics(pack.defs, catalog, { defaultCurrency: "USD" }).accepted;
    const at = (id: string) => value(ws, id, defs, catalog, "2026-01");
    // January's orders O1–O8 = 8; the cancelled one is O7: 1 ÷ 8 × 100 = 12.5. Refunded O4 (100.00) over revenue 1,875 stays the refund rate.
    expect(await at("cancellation_rate")).toBeCloseTo(12.5, 9);
    expect(await at("refund_rate")).toBeCloseTo((100 / 1875) * 100, 9);
    expect(await at("revenue")).toBeCloseTo(1875, 9);
  });

  it("a 0/1 cancellation flag marks cancelled orders: revenue leaves them out, the rate counts rows when there is no order id", async () => {
    const head = "Date,Qty,Amount,Is_Canceled";
    const rows = ["2026-01-02,1,10.00,0", "2026-01-03,1,20.00,1", "2026-01-04,1,30.00,0", "2026-01-05,1,40.00,0"];
    const { ws, summary, catalog } = await setup(head, rows, {
      date: "transaction_date",
      qty: "quantity",
      amount: "amount",
      is_canceled: "status",
    });
    const defs = validateMetrics(salesKpiPack(summary).defs, catalog, { defaultCurrency: "USD" }).accepted;
    // 10 + 30 + 40 = 80 kept; 1 of 4 rows cancelled: 25
    expect(await value(ws, "revenue", defs, catalog, "2026-01")).toBe(80);
    expect(await value(ws, "cancellation_rate", defs, catalog, "2026-01")).toBeCloseTo(25, 9);
    expect(defs.find((d) => d.id === "orders")).toBeUndefined();
  });

  it("a table that is not sales lines or invoices still gets revenue but owes no not-run list", async () => {
    const { summary } = await setup(HEAD, ROWS, { date: "transaction_date", amount: "amount" }, "other");
    const pack = salesKpiPack(summary);
    expect(pack.defs.map((d) => d.id)).toEqual(["revenue"]);
    expect(pack.notDrafted).toEqual([]);
  });
});

describe("dedupe by definition", () => {
  const rev = {
    id: "revenue",
    label: "Revenue",
    type: "sum" as const,
    table: "t_t1",
    expression: "amount",
    unit: "currency" as const,
    currency: "USD",
    status: "assumed" as const,
  };

  it("a model metric with the pack's definition is merged into it, not doubled; refs follow; dimensions are united", async () => {
    const { catalog } = await setup();
    const pack = [{ ...rev, time_column: "date", dimensions: ["customer"] }];
    const model = [
      { ...rev, id: "total_revenue", label: "Total revenue", time_column: "date", expression: " amount ", dimensions: ["product"] },
      {
        id: "margin_ish",
        label: "Share",
        type: "ratio" as const,
        numerator: { metric: "total_revenue" },
        denominator: { metric: "revenue" },
        unit: "percent" as const,
        status: "assumed" as const,
      },
      {
        id: "twice",
        label: "Twice",
        type: "derived" as const,
        expression: "total_revenue * 2",
        unit: "currency" as const,
        currency: "USD",
        status: "assumed" as const,
      },
    ];
    const m = mergeMetricSets([pack, model], catalog);
    expect(m.merged).toEqual([{ id: "total_revenue", into: "revenue" }]);
    expect(m.accepted.map((d) => d.id)).toEqual(["revenue", "margin_ish", "twice"]);
    expect(m.accepted[0]?.dimensions).toEqual(["customer", "product"]);
    expect(m.accepted[1]?.numerator).toEqual({ metric: "revenue" });
    expect(m.accepted[2]?.expression).toBe("revenue * 2");
  });

  it("filters compare as a set and ignore spacing and case of keywords; a different filter is a different metric", async () => {
    const { catalog } = await setup();
    const a = { ...rev, filters: ["status <> 'refunded'", "qty > 0"] };
    const same = { ...rev, id: "net_sales", filters: ["qty  >  0", "status<>'refunded'"] };
    const other = { ...rev, id: "paid_sales", filters: ["status = 'paid'"] };
    const m = mergeMetricSets([[a], [same, other]], catalog);
    expect(m.accepted.map((d) => d.id)).toEqual(["revenue", "paid_sales"]);
  });

  it("an id taken by a different definition is dropped with its reason; the same id and definition is one metric", async () => {
    const { catalog } = await setup();
    const different = { ...rev, expression: "qty" };
    const m = mergeMetricSets([[rev], [different, { ...rev }]], catalog);
    expect(m.accepted).toEqual([rev]);
    expect(m.dropped.map((d) => d.id)).toEqual(["revenue"]);
  });

  it("two ratios with the same terms are one metric", async () => {
    const { catalog } = await setup();
    const aov = {
      id: "aov",
      label: "AOV",
      type: "ratio" as const,
      numerator: { metric: "revenue" },
      denominator: { metric: "orders" },
      unit: "ratio" as const,
      status: "assumed" as const,
    };
    const m = mergeMetricSets([[rev, aov], [{ ...aov, id: "average_order_value" }]], catalog);
    expect(m.accepted.map((d) => d.id)).toEqual(["revenue", "aov"]);
  });

  it("draftMetrics merges a model's equal definition into the pack's, so the set does not grow", async () => {
    const { summary, catalog } = await setup();
    const pack = salesKpiPack(summary).defs.find((d) => d.id === "revenue");
    const { FakeModel } = await import("@agentic-analytics/models/testing");
    const model = new FakeModel([{ role: "extractor", match: "<DATA>", object: { metrics: [{ ...pack, id: "sales", label: "Sales" }] } }]);
    const draft = await draftMetrics(summary, catalog, { model, defaultCurrency: "USD" });
    expect(draft.source).toBe("model");
    expect(draft.merged).toEqual([{ id: "sales", into: "revenue" }]);
    expect(draft.validation.accepted.filter((d) => d.expression === "amount" && d.type === "sum")).toHaveLength(1);
  });
});

describe("slices by definition (the [M14a] families gap)", () => {
  it("a metric with the same aggregate and more filters is a slice of the one with fewer; a different expression is not", () => {
    const base = {
      label: "x",
      type: "sum" as const,
      table: "t_t1",
      unit: "currency" as const,
      currency: "USD",
      status: "assumed" as const,
    };
    const defs = [
      { ...base, id: "revenue", expression: "amount", filters: ["status <> 'refunded'"] },
      { ...base, id: "walkin_sales", expression: "amount", filters: ["status <> 'refunded'", "channel = 'walkin'"] },
      { ...base, id: "walkin_online", expression: "amount", filters: ["status <> 'refunded'", "channel = 'walkin'", "region = 'n'"] },
      { ...base, id: "cost", expression: "cost", filters: ["status <> 'refunded'", "channel = 'walkin'"] },
    ];
    expect([...sliceParents(defs)]).toEqual([
      ["walkin_sales", "revenue"],
      ["walkin_online", "revenue"],
    ]);
  });
});
