// The role detector (docs/specs/semantics.md §2). Every expectation is written by hand from the spec's rules, not read
// back from the detector's output.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ColumnType, loadTable, type NormalizedTable, type NormalizedValue, Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import {
  columnCandidates,
  detectRoles,
  halfMinorUnit,
  headerTokens,
  identityHolds,
  loadRoles,
  maskSample,
  parseRole,
  profileTable,
  ROLES,
  type Role,
  type RoleColumn,
  RoleError,
  type RoleTieBreak,
  saveRoles,
} from "../src/index.ts";

const root = join(import.meta.dirname, "..", "..", "..");

// ---- pure scoring: one column at a time -------------------------------------------------------------------------

function col(label: string, type: ColumnType, over: Partial<RoleColumn> = {}): RoleColumn {
  return {
    name: label.toLowerCase().replace(/\W+/g, "_"),
    label,
    type,
    position: 0,
    rows: 1000,
    non_null: 1000,
    distinct: 500,
    min: null,
    max: null,
    top: [],
    ...over,
  };
}
/** The proposal the detector would make from the column alone: top candidate at 0.4 or more, else none. */
function propose(c: RoleColumn): Role {
  const top = columnCandidates(c)[0];
  return top && top.score >= 0.4 ? top.role : "none";
}

describe("vocabulary", () => {
  it("is exactly the spec's table, in order", () => {
    const spec = readFileSync(join(root, "docs", "specs", "semantics.md"), "utf8");
    const vocab = spec.slice(spec.indexOf("## 1. The role vocabulary"), spec.indexOf("## 2. The role detector"));
    expect([...vocab.matchAll(/^\|[^|]*\| `([a-z_]+)` \|/gm)].map((m) => m[1])).toEqual([...ROLES]);
  });

  it("parseRole refuses a role outside it with a typed error", () => {
    expect(parseRole("unit_cost")).toBe("unit_cost");
    expect(() => parseRole("revenue")).toThrow(RoleError);
    try {
      parseRole("revenue");
    } catch (e) {
      expect((e as RoleError).code).toBe("UNKNOWN_ROLE");
    }
  });
});

describe("header normalization (§2.1)", () => {
  it("splits case-joins and punctuation", () => {
    expect(headerTokens("UnitPrice")).toEqual(["unit", "price"]);
    expect(headerTokens("Customer ID")).toEqual(["customer", "id"]);
    expect(headerTokens("IsCanceled")).toEqual(["is", "canceled"]);
    expect(headerTokens("ADR")).toEqual(["adr"]);
    expect(headerTokens("Series_title_2")).toEqual(["series", "title", "2"]);
    expect(headerTokens("Стоимость, сум")).toEqual(["стоимость", "сум"]);
    expect(headerTokens("to'lov muddati")).toEqual(["tolov", "muddati"]);
  });
});

describe("name, type and value signals, per role", () => {
  const cases: [string, ColumnType, Role, Partial<RoleColumn>?][] = [
    ["Date", "date", "transaction_date"],
    ["Order Date", "datetime", "transaction_date"],
    ["Due Date", "date", "due_date"],
    ["Issue Date", "date", "issue_date"],
    ["Paid Date", "date", "paid_date"],
    ["Snapshot Date", "date", "snapshot_date"],
    ["Period", "date", "period"],
    ["Month", "date", "period"],
    ["Order ID", "id", "order_id"],
    ["Invoice", "id", "invoice_id"],
    ["Invoice No", "text", "invoice_id"],
    ["Customer ID", "integer", "customer_id"],
    ["Client code", "category", "customer_id"],
    ["StockCode", "category", "product_id"],
    ["SKU", "text", "product_id"],
    ["Supplier Code", "category", "supplier_id"],
    ["Customer", "category", "customer", { distinct: 6 }],
    ["Client", "text", "customer"],
    ["Product", "category", "product", { distinct: 4 }],
    ["Product group", "category", "product_group", { distinct: 9 }],
    ["Channel", "category", "channel", { distinct: 2 }],
    ["Country", "category", "location", { distinct: 40 }],
    ["Supplier", "category", "supplier", { distinct: 30 }],
    ["Agent", "category", "salesperson", { distinct: 300 }],
    ["Amount", "currency", "amount"],
    ["Qty", "integer", "quantity", { distinct: 23 }],
    ["Price", "currency", "unit_price"],
    ["UnitCost", "currency", "unit_cost"],
    ["Std cost", "currency", "unit_cost"],
    ["COGS", "currency", "cost_amount"],
    ["Discount", "currency", "discount"],
    ["Tax", "currency", "tax"],
    ["Refund", "currency", "refund_amount"],
    ["Status", "category", "status", { distinct: 2 }],
    ["Currency", "category", "currency", { distinct: 3, top: ["USD", "EUR", "GBP"] }],
    ["Notes", "text", "description"],
    ["Balance", "currency", "balance"],
    ["Stock on hand", "integer", "stock_on_hand"],
    ["Bookings", "integer", "count"],
    ["Margin", "currency", "measure"],
  ];
  for (const [label, type, role, over] of cases)
    it(`${label} (${type}) → ${role}`, () => expect(propose(col(label, type, over))).toBe(role));

  it("reads synonyms in Russian and Uzbek, in Latin and Cyrillic script", () => {
    const m: [string, ColumnType, Role][] = [
      ["Количество", "integer", "quantity"],
      ["Цена", "currency", "unit_price"],
      ["Сумма", "currency", "amount"],
      ["Скидка", "currency", "discount"],
      ["Клиент", "category", "customer"],
      ["Дата продажи", "date", "transaction_date"],
      ["Срок оплаты", "date", "due_date"],
      ["Поставщик", "category", "supplier"],
      ["Mijoz", "category", "customer"],
      ["Narx", "currency", "unit_price"],
      ["Miqdori", "integer", "quantity"],
      ["Chegirma", "currency", "discount"],
      ["Sotuv sanasi", "date", "transaction_date"],
      ["Мижоз", "category", "customer"],
      ["Нарх", "currency", "unit_price"],
      ["Сумма", "decimal", "amount"],
    ];
    for (const [label, type, role] of m) expect(propose(col(label, type, { distinct: 20 })), label).toBe(role);
  });

  it("a header's last word decides: a customer type is a type, not a customer", () => {
    expect(propose(col("CustomerType", "category", { distinct: 4 }))).toBe("dimension");
    expect(propose(col("DistributionChannel", "category", { distinct: 5 }))).toBe("channel");
    expect(propose(col("StaysInWeekNights", "integer", { distinct: 35 }))).toBe("quantity");
  });

  it("ids are not dimensions or measures: a numeric code and a text code", () => {
    expect(propose(col("Customer ID", "integer"))).toBe("customer_id");
    expect(propose(col("Ref No", "integer", { distinct: 1000, non_null: 1000 }))).toBe("none");
  });

  it("the type gate: a text column is never a quantity, a category never a period", () => {
    expect(propose(col("Quantity", "text"))).not.toBe("quantity");
    expect(propose(col("ArrivalDateMonth", "category", { distinct: 12 }))).toBe("dimension");
    expect(propose(col("ArrivalDateYear", "integer", { distinct: 3 }))).toBe("measure");
  });

  it("year and month parts are not periods; a month typed as a date is", () => {
    expect(propose(col("Year", "integer", { distinct: 3 }))).not.toBe("period");
    expect(propose(col("Month", "category", { distinct: 12 }))).not.toBe("period");
    expect(propose(col("Month", "date", { distinct: 12, non_null: 12, rows: 12 }))).toBe("period");
  });

  it("a status flag stored as 0/1 is a status; a counter named cancelled is not", () => {
    expect(propose(col("IsCanceled", "integer", { distinct: 2 }))).toBe("status");
    expect(propose(col("PreviousBookingsNotCanceled", "integer", { distinct: 73 }))).toBe("measure");
  });

  it("an unnamed varying number is a measure and an unnamed category a dimension", () => {
    expect(propose(col("LeadTime", "integer", { distinct: 479 }))).toBe("measure");
    expect(propose(col("Meal", "category", { distinct: 5 }))).toBe("dimension");
  });

  it("no evidence, no role: empty, constant and free-text columns", () => {
    expect(propose(col("Suppressed", "text", { non_null: 0, distinct: 0 }))).toBe("none");
    expect(propose(col("Magnitude", "integer", { distinct: 1 }))).toBe("none");
    expect(propose(col("Subject", "text", { distinct: 1 }))).toBe("none");
    expect(propose(col("Whatever", "text", { distinct: 900 }))).toBe("none");
  });

  it("constancy is evidence only over enough rows: twelve equal rents are still a measure", () => {
    expect(propose(col("Rent", "integer", { rows: 12, non_null: 12, distinct: 1 }))).toBe("measure");
  });

  it("the 100-row floor: a constant column is technical at 100 rows, a flat measure at 99", () => {
    expect(propose(col("Rent", "integer", { rows: 99, non_null: 99, distinct: 1 }))).toBe("measure");
    expect(propose(col("Rent", "integer", { rows: 100, non_null: 100, distinct: 1 }))).toBe("none");
  });

  it("market segments and room types are dimensions (a segment is not a sales channel)", () => {
    for (const h of ["MarketSegment", "ReservedRoomType", "AssignedRoomType"])
      expect(propose(col(h, "category", { distinct: 9 })), h).toBe("dimension");
  });

  it("amount, unit price and discount are told apart by their names", () => {
    expect(propose(col("Amount", "currency"))).toBe("amount");
    expect(propose(col("Unit Price", "currency"))).toBe("unit_price");
    expect(propose(col("Discount", "currency"))).toBe("discount");
    expect(propose(col("Discount %", "percent"))).toBe("measure"); // a rate is not a money discount
  });

  it("scores are capped at 1 and carry their evidence", () => {
    const top = columnCandidates(col("Qty", "integer", { distinct: 300 }))[0];
    expect(top?.role).toBe("quantity");
    // exact name 0.5 + type 0.1 + many distinct values 0.2
    expect(top?.score).toBeCloseTo(0.8, 10);
    expect(top?.evidence.map((e) => e.signal)).toEqual(["name", "value", "type"]);
  });

  it("is deterministic: the same column gives the same candidates", () => {
    const c = col("Amount", "currency");
    expect(columnCandidates(c)).toEqual(columnCandidates(c));
  });

  it("ties go to the role earlier in the vocabulary", () => {
    // "Description": product (exact 0.5 + 0.1) and nothing else of equal score.
    const cs = columnCandidates(col("Description", "text", { distinct: 900 }));
    expect(cs[0]?.role).toBe("product");
  });
});

describe("identity thresholds (§2.2)", () => {
  it("19 of 20 rows is 95% and holds; 18 of 20 is 90% and doesn't; fewer than 5 rows never holds", () => {
    expect(identityHolds(19, 20)).toBe(true);
    expect(identityHolds(18, 20)).toBe(false);
    expect(identityHolds(4, 4)).toBe(false);
  });
  it("half a minor unit: 0.005 for two decimals, 0.5 for none", () => {
    expect(halfMinorUnit("GBP")).toBe(0.005);
    expect(halfMinorUnit(undefined)).toBe(0.005);
    expect(halfMinorUnit("JPY")).toBe(0.5);
  });
});

// ---- in DuckDB: identities and whole tables ---------------------------------------------------------------------

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});

interface Spec {
  readonly label: string;
  readonly type: ColumnType;
  readonly currency?: string;
}
function fixture(specs: readonly Spec[], rows: readonly (readonly NormalizedValue[])[], id = "T1"): NormalizedTable {
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
async function detect(t: NormalizedTable, dateColumn?: string) {
  const ws = await Workspace.open();
  open.push(ws);
  await loadTable(ws, t);
  const profile = await profileTable(ws, t, dateColumn);
  return { ws, profile, roles: await detectRoles(ws, t, profile) };
}
const roleOf = (r: Awaited<ReturnType<typeof detect>>["roles"], label: string) => r.columns.find((c) => c.label === label)?.role;

describe("the KPI fixture of analysis-library §8.2 (gross 8 of 10 rejected, net 10 of 10 accepted)", () => {
  // line, order, customer, product, qty, unit price, discount, amount, status
  const rows = [
    [1, "O1", "C1", "A", 2, 100, 0, 200, "paid"],
    [2, "O1", "C1", "B", 1, 150, 0, 150, "paid"],
    [3, "O2", "C2", "A", 3, 100, 0, 300, "paid"],
    [4, "O3", "C1", "B", 2, 150, 0, 300, "paid"],
    [5, "O4", "C3", "A", 1, 100, 0, 100, "refunded"],
    [6, "O5", "C4", "C", 4, 50, 20, 180, "paid"],
    [7, "O6", "C2", "D", 5, 85, 0, 425, "paid"],
    [8, "O7", "C5", "B", 1, 150, 0, 150, "refunded"],
    [9, "O8", "C3", "B", 2, 150, 30, 270, "paid"],
    [10, "O8", "C3", "C", 1, 50, 0, 50, "paid"],
  ] as const;
  const specs: Spec[] = [
    { label: "Line", type: "integer" },
    { label: "Order", type: "id" },
    { label: "Customer", type: "category" },
    { label: "Product", type: "category" },
    { label: "Qty", type: "integer" },
    { label: "Unit Price", type: "currency", currency: "GBP" },
    { label: "Discount", type: "currency", currency: "GBP" },
    { label: "Amount", type: "currency", currency: "GBP" },
    { label: "Status", type: "category" },
  ];

  it("measures the identities and proposes every role", async () => {
    const { roles } = await detect(fixture(specs, rows));
    const gross = roles.identities.find((i) => i.check === "gross_line");
    const net = roles.identities.find((i) => i.check === "net_line");
    expect(gross).toMatchObject({ matched: 8, total: 10, rate: 80, holds: false, fact: "role_identity.gross_line.T1" });
    expect(net).toMatchObject({ matched: 10, total: 10, rate: 100, holds: true, fact: "role_identity.net_line.T1" });
    expect(Object.fromEntries(roles.columns.map((c) => [c.label, c.role]))).toEqual({
      Line: "line_id",
      Order: "order_id",
      Customer: "customer",
      Product: "product",
      Qty: "quantity",
      "Unit Price": "unit_price",
      Discount: "discount",
      Amount: "amount",
      Status: "status",
    });
    // the identity is evidence on the columns it supports
    const amount = roles.columns.find((c) => c.label === "Amount");
    expect(amount?.evidence.some((e) => e.signal === "identity")).toBe(true);
  });
});

describe("identity rates on a 20-row fixture", () => {
  const specs: Spec[] = [
    { label: "Qty", type: "integer" },
    { label: "Price", type: "currency", currency: "GBP" },
    { label: "Amount", type: "currency", currency: "GBP" },
  ];
  // Plain matches vary the quantity (a constant column would read as technical): q = i + 1, p = 10, a = 10 × q.
  const plain = (i: number) => [i + 1, 10, (i + 1) * 10];
  // q = 3, p = 33.33, a = 100.00: |99.99 − 100.00| = 0.01 ≤ max(0.005, 0.5% × 100 = 0.5): a match too.
  const tolerance = [3, 33.33, 100];
  // q = 3, p = 0.33, a = 1.00: |0.99 − 1.00| = 0.01 > max(0.005, 0.005): a miss.
  const bad = [3, 0.33, 1];
  const matching = (n: number) => [...Array.from({ length: n - 1 }, (_, i) => plain(i)), tolerance];

  it("19 matching rows of 20: 95%, the identity holds", async () => {
    const { roles } = await detect(fixture(specs, [...matching(19), bad]));
    expect(roles.identities.find((i) => i.check === "gross_line")).toMatchObject({ matched: 19, total: 20, rate: 95, holds: true });
  });

  it("18 matching rows of 20: 90%, rejected, and the roles get no identity points", async () => {
    const { roles } = await detect(fixture(specs, [...matching(18), bad, bad]));
    const gross = roles.identities.find((i) => i.check === "gross_line");
    expect(gross).toMatchObject({ matched: 18, total: 20, rate: 90, holds: false });
    expect(roles.columns.every((c) => c.evidence.every((e) => e.signal !== "identity"))).toBe(true);
    // the names alone still give the roles: an identity below 95% is evidence against, never a hard rule
    expect(roleOf(roles, "Qty")).toBe("quantity");
  });

  it("rows with a null in any term count neither way", async () => {
    const rows = [...Array.from({ length: 10 }, (_, i) => plain(i)), [null, 1, 1], [2, null, 1], [2, 1, null]];
    const { roles } = await detect(fixture(specs, rows));
    expect(roles.identities.find((i) => i.check === "gross_line")).toMatchObject({ matched: 10, total: 10 });
  });

  it("zero-decimal currencies use a half unit of 0.5", async () => {
    // q = 2, p = 10, a = 20.4: |20 − 20.4| = 0.4 ≤ max(0.5, 0.102) = 0.5 in JPY; in GBP 0.4 > max(0.005, 0.102).
    const rows = Array(10).fill([2, 10, 20.4]);
    const yen = await detect(
      fixture(
        specs.map((s) => ({ ...s, currency: "JPY" })),
        rows,
      ),
    );
    expect(yen.roles.identities.find((i) => i.check === "gross_line")).toMatchObject({ matched: 10, total: 10, holds: true });
    const gbp = await detect(fixture(specs, rows, "T2"));
    expect(gbp.roles.identities.find((i) => i.check === "gross_line")).toMatchObject({ matched: 0, total: 10, holds: false });
  });
});

describe("margin identity needs a cost candidate", () => {
  const specs: Spec[] = [
    { label: "Qty", type: "integer" },
    { label: "Price", type: "currency", currency: "GBP" },
    { label: "Std cost", type: "currency", currency: "GBP" },
    { label: "Amount", type: "currency", currency: "GBP" },
    { label: "Gross", type: "currency", currency: "GBP" },
  ];
  // a − q × c: 200 − 2×60 = 80; 150 − 1×90 = 60; 300 − 3×60 = 120; 280 − 4×50 = 80; 90 − 1×40 = 50 ...
  const rows = [
    [2, 100, 60, 200, 80],
    [1, 150, 90, 150, 60],
    [3, 100, 60, 300, 120],
    [4, 70, 50, 280, 80],
    [1, 90, 40, 90, 50],
    [2, 100, 60, 200, 80],
  ];
  it("reads Std cost as a unit cost, not a deviation, and the margin column as a measure", async () => {
    const { roles } = await detect(fixture(specs, rows));
    expect(roleOf(roles, "Std cost")).toBe("unit_cost");
    expect(roleOf(roles, "Gross")).toBe("measure");
    expect(roles.identities.find((i) => i.check === "margin")).toMatchObject({ matched: 6, total: 6, holds: true });
    const gross = roles.columns.find((c) => c.label === "Gross");
    expect(gross?.evidence.map((e) => e.text).join(" ")).toMatch(/margin identity holds on 100\.0%/);
  });

  it("no cost column, no margin identity", async () => {
    const noCost = fixture(
      specs.filter((s) => s.label !== "Std cost"),
      rows.map(([q, p, , a, m]) => [q ?? null, p ?? null, a ?? null, m ?? null]),
    );
    const { roles } = await detect(noCost);
    expect(roles.identities.some((i) => i.check === "margin")).toBe(false);
  });
});

describe("dates: due on or after issue", () => {
  const specs: Spec[] = [
    { label: "Invoice No", type: "id" },
    { label: "Issued", type: "date" },
    { label: "Pay by", type: "date" },
    { label: "Customer", type: "category" },
  ];
  it("an unnamed date on or after the issue date on ≥ 95% of rows is the due date", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => [
      `INV-${i}`,
      `2026-01-${String(i + 1).padStart(2, "0")}`,
      `2026-02-${String(i + 1).padStart(2, "0")}`,
      "A",
    ]);
    const { roles } = await detect(fixture(specs, rows));
    expect(roleOf(roles, "Issued")).toBe("issue_date");
    expect(roleOf(roles, "Pay by")).toBe("due_date");
    expect(roles.identities.find((i) => i.check === "dates")).toMatchObject({ matched: 20, total: 20, holds: true });
  });

  it("a date column equal to the issue date on every row is a copy, not a due date", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => [
      `INV-${i}`,
      `2026-01-${String(i + 1).padStart(2, "0")}`,
      `2026-01-${String(i + 1).padStart(2, "0")}`,
      "A",
    ]);
    const { roles } = await detect(fixture(specs, rows));
    expect(roleOf(roles, "Pay by")).not.toBe("due_date");
  });

  it("one transaction date per table: a second date with a weaker date name is a different date", async () => {
    const t = fixture(
      [
        { label: "ArrivalDate", type: "date" },
        { label: "ReservationStatusDate", type: "date" },
        { label: "Qty", type: "integer" },
      ],
      Array.from({ length: 6 }, (_, i) => [`2026-01-0${i + 1}`, `2026-02-0${i + 1}`, i + 1]),
    );
    const { roles } = await detect(t, "arrivaldate");
    expect(roleOf(roles, "ArrivalDate")).toBe("transaction_date");
    expect(roleOf(roles, "ReservationStatusDate")).toBe("none");
  });
});

describe("a table end to end", () => {
  it("a column with no evidence at all gets no role", async () => {
    const t = fixture(
      [
        { label: "Blah", type: "text" },
        { label: "Qty", type: "integer" },
      ],
      Array.from({ length: 6 }, (_, i) => [`free text ${i}`, i + 1]),
    );
    const { roles } = await detect(t);
    expect(roleOf(roles, "Blah")).toBe("none");
    expect(roles.columns.find((c) => c.label === "Blah")?.candidates).toEqual([]);
  });

  it("stores proposals and candidates in the workspace", async () => {
    const t = fixture(
      [
        { label: "Customer", type: "category" },
        { label: "Amount", type: "currency" },
      ],
      [
        ["A", 1],
        ["B", 2],
        ["C", 3],
      ],
    );
    const { ws, roles } = await detect(t);
    await saveRoles(ws, roles);
    await saveRoles(ws, roles); // saving again replaces, never duplicates
    const stored = await loadRoles(ws, "T1");
    expect(stored.map((r) => [r.column_name, r.role, r.status, r.source])).toEqual([
      ["amount", "amount", "proposed", "detector"],
      ["customer", "customer", "proposed", "detector"],
    ]);
  });
});

describe("the optional model tie-break (§2.4), with a scripted stand-in", () => {
  // "Net value" ends with the amount synonym "value": amount scores 0.35 + 0.1 = 0.45; a varying number is also a
  // measure at 0.1 + 0.3 = 0.4. The two are within 0.1, so a tie-break may choose between them.
  const t = fixture(
    [{ label: "Net value", type: "currency" }],
    Array.from({ length: 6 }, (_, i) => [10 + i]),
  );
  async function run(answer: Role | "undecided" | undefined, table = t) {
    const asked: { candidates: { role: Role }[]; samples: string[] }[] = [];
    const tieBreak: RoleTieBreak | undefined = answer
      ? {
          async choose(q) {
            asked.push({ candidates: [...q.candidates], samples: [...q.samples] });
            return answer;
          },
        }
      : undefined;
    const ws = await Workspace.open();
    open.push(ws);
    await loadTable(ws, table);
    const profile = await profileTable(ws, table);
    const roles = await detectRoles(ws, table, profile, tieBreak ? { tieBreak } : {});
    return { column: roles.columns[0], asked };
  }

  it("with no tie-break the top score wins", async () => {
    const { column } = await run(undefined);
    expect(column).toMatchObject({ role: "amount", source: "detector" });
    expect(column?.candidates.map((c) => [c.role, Math.round(c.score * 100) / 100])).toEqual([
      ["amount", 0.45],
      ["measure", 0.4],
    ]);
  });

  it("is asked with the close candidates only, and its choice is recorded in the evidence", async () => {
    const { column, asked } = await run("measure");
    expect(asked).toHaveLength(1);
    expect(asked[0]?.candidates.map((c) => c.role)).toEqual(["amount", "measure"]);
    expect(asked[0]?.samples).toEqual(["99.9", "99.9", "99.9", "99.9", "99.9"]); // 10.0 … 15.0 with every digit masked
    expect(column).toMatchObject({ role: "measure", source: "model" });
    expect(column?.evidence.map((e) => e.text)).toContain("tie broken by model");
  });

  it("discards a role the code didn't offer, and an undecided answer", async () => {
    for (const answer of ["tax", "undecided"] as const) {
      const { column } = await run(answer);
      expect(column).toMatchObject({ role: "amount", source: "detector" });
    }
  });

  it("is not asked when the top two are more than 0.1 apart", async () => {
    const far = fixture(
      [{ label: "Amount", type: "currency" }],
      Array.from({ length: 6 }, (_, i) => [10 + i]),
    );
    const { asked, column } = await run("measure", far);
    expect(asked).toHaveLength(0);
    expect(column?.role).toBe("amount");
  });

  it("masks digits in the samples it shows", () => {
    expect(maskSample("ID 4521-77")).toBe("ID 9999-99");
  });
});

describe("year and month number columns form the period when the table has no date column (§2.1)", () => {
  const rows = (f: (i: number) => (string | number)[]) => Array.from({ length: 12 }, (_, i) => f(i));
  const year = (i: number) => (i < 6 ? 2017 : 2018);

  it("a year column and a month-number column are the period, and the pair is exposed", async () => {
    const t = fixture(
      [
        { label: "calendar_year", type: "integer" },
        { label: "cal_month_num", type: "integer" },
        { label: "Sales", type: "currency" },
      ],
      rows((i) => [year(i), (i % 6) + 1, 10 + i]),
    );
    const { roles } = await detect(t);
    expect(roleOf(roles, "calendar_year")).toBe("period");
    expect(roleOf(roles, "cal_month_num")).toBe("period");
    expect(roles.period_parts).toEqual({ year: "calendar_year", month: "cal_month_num" });
  });

  it("a year column alone is a period; the Russian and Uzbek words count", async () => {
    for (const label of ["Год", "Yil", "fiscal_yr"]) {
      const { roles } = await detect(
        fixture(
          [
            { label, type: "integer" },
            { label: "Sales", type: "currency" },
          ],
          rows((i) => [year(i), 10 + i]),
        ),
      );
      expect(roleOf(roles, label), label).toBe("period");
      expect(roles.period_parts).toEqual({ year: label.toLowerCase().replace(/\W+/g, "_") });
    }
  });

  it("negatives: a 1-12 quantity without a month word, a year-range amount without a year word", async () => {
    const { roles } = await detect(
      fixture(
        [
          { label: "year", type: "integer" },
          { label: "Qty", type: "integer" },
          { label: "Amount", type: "integer" },
        ],
        rows((i) => [year(i), (i % 12) + 1, 2000 + i]),
      ),
    );
    expect(roleOf(roles, "Qty")).toBe("quantity");
    expect(roleOf(roles, "Amount")).toBe("amount");
    expect(roles.period_parts).toEqual({ year: "year" });
  });

  it("negatives: a month number with no year column beside it, and a year outside 1900-2100", async () => {
    const m = await detect(
      fixture(
        [
          { label: "Month", type: "integer" },
          { label: "Sales", type: "currency" },
        ],
        rows((i) => [(i % 12) + 1, 10 + i]),
      ),
    );
    expect(roleOf(m.roles, "Month")).not.toBe("period");
    expect(m.roles.period_parts).toBeUndefined();
    const y = await detect(
      fixture(
        [
          { label: "Year", type: "integer" },
          { label: "Sales", type: "currency" },
        ],
        rows((i) => [1000 + i, 10 + i]),
      ),
    );
    expect(roleOf(y.roles, "Year")).not.toBe("period");
  });

  it("with a date column, year and month numbers are only parts of it", async () => {
    const { roles } = await detect(
      fixture(
        [
          { label: "ArrivalDate", type: "date" },
          { label: "ArrivalDateYear", type: "integer" },
          { label: "Month", type: "integer" },
        ],
        rows((i) => [`${year(i)}-0${(i % 6) + 1}-01`, year(i), (i % 6) + 1]),
      ),
      "arrivaldate",
    );
    expect(roleOf(roles, "ArrivalDateYear")).not.toBe("period");
    expect(roles.period_parts).toBeUndefined();
  });
});
