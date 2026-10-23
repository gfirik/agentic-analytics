// Table kinds (semantics §3) and the business model (§4). Every expectation is written by hand from the spec's rules.
import { type ColumnType, loadTable, type NormalizedTable, type NormalizedValue, Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyKind,
  classifyTable,
  detectRoles,
  inferBusinessModel,
  loadRoles,
  loadTableKinds,
  profileTable,
  ROLES,
  type Role,
  reportSemantics,
  saveRoles,
  saveTableKind,
  TABLE_KINDS,
  type TableRoles,
} from "../src/index.ts";

/** A table whose columns are given as `column → role` (scores 1, in the order written). */
function roles(map: Record<string, Role>, identities: TableRoles["identities"] = []): TableRoles {
  return {
    table_id: "T1",
    identities,
    columns: Object.entries(map).map(([column, role], position) => ({
      column,
      label: column,
      position,
      candidates: [],
      role,
      score: 1,
      evidence: [],
      source: "detector" as const,
    })),
  };
}
const kind = (map: Record<string, Role>, ctx = {}, ids: TableRoles["identities"] = []) => classifyKind(roles(map, ids), ctx);

describe("classifyKind: one fixture per kind (§3)", () => {
  it("invoices: invoice id + issue date + due date + a customer, no supplier", () => {
    const k = kind({ inv: "invoice_id", issued: "issue_date", due: "due_date", cust: "customer", paid: "paid_amount", total: "amount" });
    expect(k.kind).toBe("invoices");
    expect(k.evidence).toEqual(["invoice_id", "issue_date", "due_date", "customer", "paid_amount"]);
  });

  it("bills: the same with a supplier instead of a customer", () => {
    expect(kind({ inv: "invoice_id", issued: "issue_date", due: "due_date", sup: "supplier_id" }).kind).toBe("bills");
  });

  it("ambiguity: an invoice register with a supplier column and no customer column is bills, not invoices", () => {
    const k = kind({ inv: "invoice_id", issued: "issue_date", due: "due_date", vendor: "supplier", total: "amount" });
    expect(k.kind).toBe("bills");
    expect(k.evidence).toContain("supplier");
  });

  it("an invoice register with both a customer and a supplier is neither invoices nor bills", () => {
    const k = kind({ inv: "invoice_id", issued: "issue_date", due: "due_date", c: "customer", s: "supplier" });
    expect(["invoices", "bills"]).not.toContain(k.kind);
  });

  it("inventory_snapshot: a snapshot date, a product and stock on hand", () => {
    const k = kind({ as_of: "snapshot_date", sku: "product_id", stock: "stock_on_hand" });
    expect(k).toMatchObject({ kind: "inventory_snapshot", evidence: ["snapshot_date", "product_id", "stock_on_hand"] });
  });

  it("bank_cash: a date, a signed amount and a balance", () => {
    const k = kind({ d: "transaction_date", amt: "amount", bal: "balance" }, { signedAmount: true });
    expect(k).toMatchObject({ kind: "bank_cash", evidence: ["transaction_date", "amount", "balance"] });
  });

  it("bank_cash: or a signed amount with a description and no product or customer", () => {
    expect(kind({ d: "transaction_date", amt: "amount", memo: "description" }, { signedAmount: true }).kind).toBe("bank_cash");
    // a customer in the table makes it something else
    expect(kind({ d: "transaction_date", amt: "amount", memo: "description", c: "customer" }, { signedAmount: true }).kind).toBe(
      "sales_lines",
    );
  });

  it("bank_cash needs both signs: an amount that is never negative is not a ledger", () => {
    expect(kind({ d: "transaction_date", amt: "amount", bal: "balance" }, { signedAmount: false }).kind).not.toBe("bank_cash");
  });

  it("budget_plan: a period or date with an amount, and a name that says budget, plan, target or forecast", () => {
    expect(kind({ m: "period", amt: "amount" }, { names: ["Budget 2026"] })).toMatchObject({
      kind: "budget_plan",
      evidence: ["period", "amount"],
    });
    expect(kind({ d: "transaction_date", t: "measure" }, { names: ["sales.xlsx", "Plan"] }).kind).toBe("budget_plan");
    expect(kind({ d: "transaction_date", amt: "amount" }, { names: ["Бюджет"] }).kind).toBe("budget_plan");
    expect(kind({ d: "transaction_date", amt: "amount" }, { names: ["reja.csv"] }).kind).toBe("budget_plan");
  });

  it("budget_plan by a header name, and not by a word that merely contains one", () => {
    expect(kind({ d: "transaction_date", forecast: "amount" }).kind).toBe("budget_plan");
    // "planet" and "explained" are not "plan"
    expect(kind({ d: "transaction_date", amt: "amount", c: "customer" }, { names: ["planet.csv"] }).kind).toBe("sales_lines");
  });

  it("period_summary: a period role (Montgomery-like year and month parts, no date)", () => {
    const parts = kind({ year: "period", month: "period", supplier: "supplier", sales: "amount", cases: "quantity" });
    expect(parts).toMatchObject({ kind: "period_summary", evidence: ["period", "amount", "quantity"] });
  });

  it("period_summary: a date that with the dimensions is a unique key", () => {
    const k = kind({ d: "transaction_date", region: "location", sales: "amount" }, { uniqueDateKey: true });
    expect(k.kind).toBe("period_summary");
    expect(k.evidence).toEqual(["transaction_date", "amount"]);
  });

  it("period_summary is refused by an id role or a line identity", () => {
    expect(kind({ d: "transaction_date", o: "order_id", c: "customer", a: "amount" }, { uniqueDateKey: true }).kind).toBe("sales_lines");
    const ident = [
      { check: "gross_line" as const, fact: "f", columns: {}, matched: 9, total: 9, rate: 100, holds: true, sql: { text: "", params: [] } },
    ];
    expect(kind({ p: "period", q: "quantity", u: "unit_price", a: "amount" }, {}, ident).kind).not.toBe("period_summary");
  });

  it("sales_lines: a date, an amount, and a customer, product, order id or channel", () => {
    expect(kind({ d: "transaction_date", a: "amount", p: "product" })).toMatchObject({
      kind: "sales_lines",
      evidence: ["transaction_date", "amount", "product"],
    });
    expect(kind({ d: "transaction_date", a: "amount", ch: "channel" }).kind).toBe("sales_lines");
    expect(kind({ d: "transaction_date", q: "quantity", p: "unit_price", o: "order_id" })).toMatchObject({
      kind: "sales_lines",
      evidence: ["transaction_date", "quantity", "unit_price", "order_id"],
    });
  });

  it("other: anything else, with no evidence", () => {
    expect(kind({ d: "transaction_date", a: "amount" })).toEqual({ table_id: "T1", kind: "other", evidence: [] });
    expect(kind({ x: "measure", y: "dimension" }).kind).toBe("other");
    expect(kind({ c: "customer", p: "product" }).kind).toBe("other");
  });

  it("rules are tried in order: invoices before sales_lines, budget before summary", () => {
    expect(kind({ inv: "invoice_id", i: "issue_date", due: "due_date", c: "customer", a: "amount", d: "transaction_date" }).kind).toBe(
      "invoices",
    );
    expect(kind({ m: "period", a: "amount" }, { names: ["Target"] }).kind).toBe("budget_plan");
  });
});

// ---- in DuckDB ------------------------------------------------------------------------------------------------------

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});
interface Spec {
  readonly label: string;
  readonly type: ColumnType;
  readonly currency?: string;
}
function table(id: string, specs: readonly Spec[], rows: readonly (readonly NormalizedValue[])[]): NormalizedTable {
  return {
    id,
    file_id: "F1",
    sheet: "S",
    range: `A1:Z${rows.length + 1}`,
    hidden_sheet: false,
    header_rows: [1],
    notes: [],
    transposed: false,
    columns: specs.map((s, i) => ({
      name: s.label.toLowerCase().replace(/\W+/g, "_"),
      label: s.label,
      letter: String.fromCharCode(65 + i),
      type: s.type,
      ...(s.currency ? { currency: s.currency } : {}),
    })),
    rows: rows.map((values, i) => ({ row: i + 2, is_total: false, period: null, values })),
  };
}
async function classify(t: NormalizedTable, names: string[] = [], dateColumn?: string) {
  const ws = await Workspace.open();
  open.push(ws);
  await loadTable(ws, t);
  const profile = await profileTable(ws, t, dateColumn);
  const r = await detectRoles(ws, t, profile);
  return { ws, profile, r, kind: await classifyTable(ws, r, profile, names) };
}

describe("classifyTable end to end", () => {
  // Montgomery-like: a year and a month part, no date column, rows already aggregated per supplier and month.
  const montgomery = () => {
    const rows: NormalizedValue[][] = [];
    for (const year of [2019, 2020])
      for (let month = 1; month <= 12; month++)
        for (const supplier of ["Acme", "Bravo"])
          rows.push([year, month, supplier, 100 + month * (supplier === "Acme" ? 3 : 5) + (year - 2019) * 7]);
    return table(
      "T1",
      [
        { label: "Year", type: "integer" },
        { label: "Month", type: "integer" },
        { label: "Supplier", type: "category" },
        { label: "Retail Sales", type: "currency", currency: "USD" },
      ],
      rows,
    );
  };

  it("year and month parts with no date column: period_summary, with the parts as its period", async () => {
    const { r, kind } = await classify(montgomery());
    expect(r.period_parts).toEqual({ year: "year", month: "month" });
    expect(kind).toEqual({ table_id: "T1", kind: "period_summary", evidence: ["period", "amount"] });
  });

  it("a monthly date that with the region is a unique key: period_summary, no id column", async () => {
    const rows: NormalizedValue[][] = [];
    for (const d of ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"])
      for (const region of ["North", "South"]) rows.push([d, region, 1000 + rows.length * 10]);
    const { kind } = await classify(
      table(
        "T1",
        [
          { label: "Date", type: "date" },
          { label: "Region", type: "category" },
          { label: "Revenue", type: "currency", currency: "USD" },
        ],
        rows,
      ),
      [],
      "date",
    );
    expect(kind.kind).toBe("period_summary");
  });

  it("the same columns with repeated dates (two rows on a day for one region) are not a unique key", async () => {
    const rows: NormalizedValue[][] = [
      ["2026-01-05", "North", 100],
      ["2026-01-05", "North", 120],
      ["2026-01-06", "South", 90],
      ["2026-01-07", "South", 95],
      ["2026-01-08", "North", 70],
      ["2026-01-08", "North", 80],
    ];
    const { kind } = await classify(
      table(
        "T1",
        [
          { label: "Date", type: "date" },
          { label: "Region", type: "category" },
          { label: "Revenue", type: "currency", currency: "USD" },
        ],
        rows,
      ),
      [],
      "date",
    );
    expect(kind.kind).not.toBe("period_summary");
  });

  it("an unrelated table is other", async () => {
    const rows: NormalizedValue[][] = Array.from({ length: 8 }, (_, i) => [`note ${i}`, i % 2 ? "yes" : "no"]);
    const { kind } = await classify(
      table(
        "T1",
        [
          { label: "Remarks", type: "text" },
          { label: "Flag", type: "category" },
        ],
        rows,
      ),
    );
    expect(kind).toEqual({ table_id: "T1", kind: "other", evidence: [] });
  });

  it("stores the kind and the roles, and replaces them on a second save", async () => {
    const { ws, r, kind } = await classify(montgomery());
    await saveRoles(ws, r);
    await saveTableKind(ws, kind);
    await saveTableKind(ws, { table_id: "T1", kind: "other", evidence: [] });
    expect(await loadTableKinds(ws)).toEqual([{ table_id: "T1", kind: "other", evidence: [] }]);
    expect((await loadRoles(ws, "T1")).find((x) => x.column_name === "year")?.role).toBe("period");
  });
});

// ---- business model ---------------------------------------------------------------------------------------------------

describe("inferBusinessModel (§4)", () => {
  const specs: Spec[] = [
    { label: "Order", type: "id" },
    { label: "Date", type: "date" },
    { label: "Customer", type: "category" },
    { label: "Channel", type: "category" },
    { label: "Qty", type: "integer" },
    { label: "Revenue", type: "currency", currency: "USD" },
  ];
  /** 12 months of 2026. `customers` gives, per customer, its monthly revenue and channel; `qty` the units of a row. */
  type Customers = Record<string, { channel: string; amount: (month: number) => number }>;
  function sales(
    customers: Customers,
    extra: NormalizedValue[][] = [],
    qty: (month: number, n: number) => number = (m, n) => ((m + n) % 5) + 2,
  ) {
    const rows: NormalizedValue[][] = [];
    let n = 0;
    for (let month = 1; month <= 12; month++)
      for (const [c, v] of Object.entries(customers)) {
        n++;
        rows.push([`O${n}`, `2026-${String(month).padStart(2, "0")}-15`, c, v.channel, qty(month, n), v.amount(month)]);
      }
    return table("T1", specs, [...rows, ...extra]);
  }
  /** `count` customers whose amounts flip between x1 and x2 every month, so no customer is ever steady. */
  const flipping = (count: number, channel: (i: number) => string, base: (i: number) => number = () => 100): Customers =>
    Object.fromEntries(
      Array.from({ length: count }, (_, k) => [
        `C${k + 1}`,
        { channel: channel(k + 1), amount: (m: number) => base(k + 1) * (m % 2 ? 1 : 2) },
      ]),
    );
  async function infer(t: NormalizedTable) {
    const c = await classify(t, [], "date");
    expect(c.kind.kind).toBe("sales_lines");
    const model = await inferBusinessModel(c.ws, [
      { kind: c.kind, roles: c.r, detail_rows: c.profile.detail_rows, date_column: c.profile.date_column },
    ]);
    return { ...c, model };
  }
  const wobble = (base: number) => (m: number) => base + (m % 2 === 0 ? 1 : 0); // every month within 5% of the one before

  it("subscription: customers with steady monthly amounts hold at least half of the last year's revenue", async () => {
    // A and B pay 100 or 101 each month; C flips between a large and a tiny amount, so it is never steady.
    const t = sales({
      A: { channel: "online", amount: wobble(100) },
      B: { channel: "online", amount: wobble(100) },
      C: { channel: "online", amount: (m) => (m % 2 ? 30 : 0.01) },
    });
    const { model } = await infer(t);
    expect(model.model).toBe("subscription");
    const f = model.signals[0]?.fact;
    // A and B: 6 months of 100 + 6 of 101 = 1206 each = 2412; C flips 30 / 0.01: 6 × 30.01 = 180.06; steady share = 2412 / 2592.06
    expect(f?.value).toBeCloseTo((2412 / 2592.06) * 100, 5);
  });

  it("wholesale by channel: a wholesale channel holds at least half", async () => {
    // 40 customers, 25 of them wholesale with equal amounts: 25 of 40 = 62.5% of the revenue, and the ten largest hold only 25%.
    const { model } = await infer(sales(flipping(40, (i) => (i <= 25 ? "Wholesale" : "web"))));
    expect(model.model).toBe("wholesale");
    expect(model.signals.find((s) => s.fact?.key.startsWith("business_model.wholesale_channel"))?.fact?.value).toBeCloseTo(62.5, 5);
  });

  it("wholesale by concentration: the ten largest customers hold at least half", async () => {
    // Ten customers at 1000 (flipping to 2000) and thirty at 10: the ten hold 10000 of 10300 = 97.087...%.
    const { model } = await infer(
      sales(
        flipping(
          40,
          () => "direct",
          (i) => (i <= 10 ? 1000 : 10),
        ),
      ),
    );
    expect(model.model).toBe("wholesale");
    expect(model.signals.at(-1)?.text).toContain("ten largest customers");
    expect(model.signals.at(-1)?.fact?.value).toBeCloseTo((10000 / 10300) * 100, 5);
  });

  it("retail: a retail channel holds at least half of the revenue", async () => {
    const { model } = await infer(sales(flipping(40, (i) => (i <= 25 ? "Retail" : "web"))));
    expect(model.model).toBe("retail");
    expect(model.signals.at(-1)?.fact?.key).toMatch(/^business_model\.retail_channel/);
  });

  it("retail: a fifth or more of the sales rows have no customer", async () => {
    // 480 rows with a customer and 150 without: 150 of 630 = 23.8095...% (the channel is 'direct', so no channel signal)
    const extra: NormalizedValue[][] = Array.from({ length: 150 }, (_, i) => [
      `X${i}`,
      "2026-06-15",
      null,
      "direct",
      2 + (i % 3),
      1 + (i % 4),
    ]);
    const { model } = await infer(
      sales(
        flipping(40, () => "direct"),
        extra,
      ),
    );
    expect(model.model).toBe("retail");
    expect(model.signals.at(-1)?.fact?.value).toBeCloseTo((150 / 630) * 100, 5);
  });

  it("services: sales with neither a quantity nor a product, and nothing else decides", async () => {
    const { model } = await infer(
      sales(
        flipping(40, () => "direct"),
        [],
        () => 1,
      ),
    );
    expect(model.model).toBe("services");
  });

  it("unknown: no signal holds", async () => {
    const { model } = await infer(sales(flipping(40, () => "direct")));
    expect(model.model).toBe("unknown");
  });

  it("no sales table: unknown, no signals", async () => {
    const c = await classify(
      table(
        "T1",
        [
          { label: "Remarks", type: "text" },
          { label: "Flag", type: "category" },
        ],
        Array.from({ length: 6 }, (_, i) => [`n${i}`, "x"]),
      ),
    );
    expect(await inferBusinessModel(c.ws, [{ kind: c.kind, roles: c.r, detail_rows: 6 }])).toEqual({ model: "unknown", signals: [] });
  });

  it("the report parts: roles with their status, identity facts that V2 can re-run, and a signal's fact", async () => {
    const c = await infer(sales(flipping(40, (i) => (i <= 25 ? "Wholesale" : "web"))));
    await saveRoles(c.ws, c.r);
    const s = await reportSemantics(c.ws, {
      roles: [c.r],
      table_kinds: [c.kind],
      business_model: c.model,
    });
    expect(s.business_model).toMatchObject({ model: "wholesale", status: "assumed" });
    expect(s.roles.every((x) => x.role !== "none" && x.status === "assumed")).toBe(true);
    // each fact re-runs to its stored value with its own SQL (what V2 does)
    expect(s.facts.length).toBeGreaterThan(0);
    for (const f of s.facts) {
      const row = await c.ws.one<{ value: number }>({ text: f.sql.text, params: f.sql.params as never });
      expect(Number(row?.value)).toBeCloseTo(f.value, 9);
    }
    // an identity's reported rate is the SQL's own result, not a JS division (AGENTS.md 2.1)
    for (const id of c.r.identities) {
      const row = await c.ws.one<{ value: number }>({ text: id.sql.text, params: id.sql.params as never });
      expect(id.rate).toBe(Number(row?.value));
    }
    // evidence text has no numerals; a measured one carries its fact key as a placeholder
    expect(s.roles.flatMap((x) => x.evidence).every((e) => !/\d/.test(e.text.replace(/\{\{[^}]*\}\}/g, "").replace(/"[^"]*"/g, "")))).toBe(
      true,
    );
  });
});

describe("the vocabularies agree", () => {
  it("the role list in report.json's schema is the detector's list, in order", async () => {
    const { COLUMN_ROLES } = await import("@agentic-analytics/schema");
    expect([...COLUMN_ROLES]).toEqual([...ROLES]);
  });
  it("the table kinds are the spec's, in the order of the schema's list", async () => {
    const { TABLE_KINDS: schemaKinds } = await import("@agentic-analytics/schema");
    expect([...schemaKinds].sort()).toEqual([...TABLE_KINDS].sort());
  });
});
