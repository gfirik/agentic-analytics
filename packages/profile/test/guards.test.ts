// Backtest pre-tag 4 (data-quality guards): rows dated after today are not history; a negative sales amount and a
// falling cumulative column are flagged (ingestion spec §5). Hand-computed expectations.

import type { Grain } from "@agentic-analytics/schema";
import { loadTable, type NormalizedTable, Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import { classifyTable, cutoffPeriod, detectRoles, profileTable, runRules } from "../src/index.ts";

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});

type Cell = string | number | null;
const table = (columns: NormalizedTable["columns"], rows: Cell[][]): NormalizedTable => ({
  id: "T1",
  file_id: "F1",
  sheet: "S",
  range: "A1:E99",
  hidden_sheet: false,
  header_rows: [1],
  notes: [],
  transposed: false,
  columns,
  rows: rows.map((values, i) => ({ row: i + 2, is_total: false, period: null, values })),
});

async function rules(t: NormalizedTable, today = "2026-07-01", grain: Grain = "month") {
  const ws = await Workspace.open();
  open.push(ws);
  await loadTable(ws, t);
  const profile = await profileTable(ws, t, "day", today, grain);
  const roles = await detectRoles(ws, t, profile);
  const kind = (await classifyTable(ws, roles, profile, [])).kind;
  return { profile, kind, issues: await runRules(ws, t, profile, today, { roles, kind, dateColumn: "day" }) };
}

const DAY = { name: "day", label: "Date", letter: "A", type: "date" } as const;
const AMOUNT = { name: "amount", label: "Amount", letter: "B", type: "decimal" } as const;

describe("dates after today are not history", () => {
  const t = table(
    [DAY, AMOUNT],
    [
      ["2026-05-10", 100],
      ["2026-06-20", 200],
      ["2026-09-05", 5000],
    ],
  );

  it("the date coverage ends at the last date on or before today", async () => {
    const { profile } = await rules(t);
    expect(profile.date_first).toBe("2026-05-10");
    expect(profile.date_last).toBe("2026-06-20");
  });

  it("the future-date issue on the period column says its rows are left out", async () => {
    const { issues } = await rules(t);
    const f = issues.filter((i) => i.kind === "future_date");
    expect(f.map((i) => [i.row, i.details.left_out])).toEqual([[4, true]]);
  });

  it("a future date in another date column is flagged but not left out", async () => {
    const two = table(
      [DAY, { name: "off", label: "Off-hire", letter: "C", type: "date" }, AMOUNT],
      [
        ["2026-05-10", "2062-01-01", 100],
        ["2026-06-20", "2026-06-25", 200],
      ],
    );
    const { issues } = await rules(two);
    expect(issues.filter((i) => i.kind === "future_date").map((i) => i.details.left_out)).toEqual([false]);
  });
});

describe("negative sales amounts", () => {
  const rows: Cell[][] = [
    ["2026-05-01", 100],
    ["2026-05-02", -40],
    ["2026-05-03", 120],
    ["2026-05-04", -5],
    ["2026-05-05", 90],
  ];

  it("are flagged with their rows when nothing marks refunds", async () => {
    const { issues } = await rules(table([DAY, AMOUNT], rows));
    const n = issues.filter((i) => i.kind === "negative_amount");
    expect(n).toHaveLength(1);
    expect(n[0]?.severity).toBe("medium");
    expect(n[0]?.rows).toEqual([3, 5]);
    expect(n[0]?.details.count).toBe(2);
  });

  it("are not flagged when a status column holds refunds", async () => {
    const t = table(
      [DAY, AMOUNT, { name: "status", label: "Status", letter: "C", type: "category" }],
      rows.map(([d, a], i) => [d ?? null, a ?? null, Number(a) < 0 ? "Refunded" : i % 2 ? "Paid" : "Shipped"]),
    );
    expect((await rules(t)).issues.filter((i) => i.kind === "negative_amount")).toEqual([]);
  });

  it("are not flagged when a column is named for refunds", async () => {
    const t = table(
      [DAY, AMOUNT, { name: "refund_flag", label: "Refund?", letter: "C", type: "boolean" }],
      rows.map(([d, a]) => [d ?? null, a ?? null, null]),
    );
    expect((await rules(t)).issues.filter((i) => i.kind === "negative_amount")).toEqual([]);
  });
});

describe("cumulative columns", () => {
  const REGION = { name: "region", label: "Region", letter: "B", type: "category" } as const;
  const CUM = { name: "cum", label: "Cumulative sales", letter: "C", type: "decimal" } as const;
  const flagged = async (rows: Cell[][]) =>
    (await rules(table([DAY, REGION, CUM], rows))).issues.filter((i) => i.kind === "non_monotone_cumulative");

  it("flags the row where the value falls within the year and the region", async () => {
    const n = await flagged([
      ["2026-01-31", "North", 10],
      ["2026-01-31", "South", 50],
      ["2026-02-28", "North", 25],
      ["2026-02-28", "South", 60],
      ["2026-03-31", "North", 20],
      ["2026-03-31", "South", 90],
    ]);
    expect(n).toHaveLength(1);
    expect(n[0]?.rows).toEqual([6]);
    expect(n[0]?.severity).toBe("medium");
  });

  it("does not flag a monotone series, a new year's restart, or a lower value in another region", async () => {
    const n = await flagged([
      ["2025-11-30", "North", 100],
      ["2025-12-31", "North", 120],
      ["2026-01-31", "North", 10],
      ["2026-02-28", "North", 25],
      ["2026-01-31", "South", 5],
      ["2026-02-28", "South", 5],
    ]);
    expect(n).toEqual([]);
  });

  it("reads cumulative header words as their own tokens (snake_case too), not inside other words", async () => {
    const falling: Cell[][] = [
      ["2026-01-31", "North", 10],
      ["2026-02-28", "North", 5],
    ];
    for (const label of ["revenue_ytd", "cum_sales", "Sales (YTD)", "sales_to_date", "Нарастающим итогом"]) {
      const t = table([DAY, REGION, { ...CUM, label }], falling);
      expect(
        (await rules(t)).issues.filter((i) => i.kind === "non_monotone_cumulative"),
        label,
      ).toHaveLength(1);
    }
    for (const label of ["cucumber_sales", "custom_total", "accumulator_id"]) {
      const t = table([DAY, REGION, { ...CUM, label }], falling);
      expect(
        (await rules(t)).issues.filter((i) => i.kind === "non_monotone_cumulative"),
        label,
      ).toEqual([]);
    }
  });

  it("only looks at columns named as cumulative", async () => {
    const plain = { ...CUM, name: "sales", label: "Sales" };
    const t = table(
      [DAY, REGION, plain],
      [
        ["2026-01-31", "North", 10],
        ["2026-02-28", "North", 5],
      ],
    );
    expect((await rules(t)).issues.filter((i) => i.kind === "non_monotone_cumulative")).toEqual([]);
  });
});

describe("rows after today inside today's own period", () => {
  const t = table(
    [DAY, AMOUNT],
    [
      ["2023-11-15", 100],
      ["2023-12-25", 200],
      ["2023-12-30", 900000],
    ],
  );

  it("drop that period whole: history ends the day before it starts", async () => {
    const { profile } = await rules(t, "2023-12-28");
    expect(profile.date_cutoff).toBe("2023-11-30");
    expect(profile.date_last).toBe("2023-11-15");
    expect(cutoffPeriod([profile], "month")).toBe("2023-11");
  });

  it("do not drop it when the future rows are in a later period", async () => {
    const later = table(
      [DAY, AMOUNT],
      [
        ["2023-11-15", 100],
        ["2023-12-25", 200],
        ["2024-02-01", 5],
      ],
    );
    const { profile } = await rules(later, "2023-12-28");
    expect(profile.date_cutoff).toBeUndefined();
    expect(profile.date_last).toBe("2023-12-25");
    expect(cutoffPeriod([profile], "month")).toBeUndefined();
  });

  it("flag every date as future when none is on or before today", async () => {
    const all = table(
      [DAY, AMOUNT],
      [
        ["2026-09-01", 1],
        ["2026-10-01", 2],
      ],
    );
    const { issues, profile } = await rules(all);
    expect(profile.date_first).toBeUndefined();
    expect(issues.filter((i) => i.kind === "future_date").every((i) => i.details.all_future === true)).toBe(true);
  });
});

describe("amount guards on other kinds of tables", () => {
  it("a bank ledger with signed amounts is not flagged", async () => {
    const t = table(
      [
        DAY,
        { name: "description", label: "Description", letter: "B", type: "text" },
        { ...AMOUNT, letter: "C" },
        { name: "balance", label: "Balance", letter: "D", type: "decimal" },
      ],
      [
        ["2026-05-01", "Salary", 3000, 3000],
        ["2026-05-02", "Rent", -1200, 1800],
        ["2026-05-03", "Groceries", -80, 1720],
        ["2026-05-04", "Refund from shop", 25, 1745],
        ["2026-05-05", "Coffee", -4, 1741],
      ],
    );
    const { kind, issues } = await rules(t);
    expect(kind).toBe("bank_cash");
    expect(issues.filter((i) => i.kind === "negative_amount")).toEqual([]);
  });

  it("a refund marker in a text column is found whatever its rank among the values", async () => {
    const statuses = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const rows: Cell[][] = statuses.flatMap((st, i) =>
      Array.from({ length: 9 - i }, (_, k) => [`2026-05-${String(i * 3 + k + 1).padStart(2, "0")}`, st, 10 + k]),
    );
    rows.push(["2026-06-01", "Refunded", -10]);
    const t = table([DAY, { name: "status", label: "Status", letter: "B", type: "category" }, { ...AMOUNT, letter: "C" }], rows);
    expect((await rules(t)).issues.filter((i) => i.kind === "negative_amount")).toEqual([]);
  });

  it("a column already reported as a negative quantity is not reported again as an amount", async () => {
    const t = table(
      [DAY, { name: "qty", label: "Qty", letter: "B", type: "integer" }],
      [
        ["2026-05-01", 3],
        ["2026-05-02", -1],
        ["2026-05-03", 4],
      ],
    );
    const ws = await Workspace.open();
    open.push(ws);
    await loadTable(ws, t);
    const profile = await profileTable(ws, t, "day", "2026-07-01");
    const roles = await detectRoles(ws, t, profile);
    const forced = { ...roles, columns: roles.columns.map((c) => (c.column === "qty" ? { ...c, role: "amount" as const } : c)) };
    const issues = await runRules(ws, t, profile, "2026-07-01", { roles: forced, kind: "sales_lines", dateColumn: "day" });
    expect(issues.map((i) => i.kind)).toEqual(["negative_quantity"]);
  });
});

describe("cumulative series are told apart by id and text members too", () => {
  it("an id-typed store code keeps its own series", async () => {
    const STORE = { name: "store_code", label: "Store code", letter: "B", type: "id" } as const;
    const CUM = { name: "cum", label: "YTD sales", letter: "C", type: "decimal" } as const;
    const t = table(
      [DAY, STORE, CUM],
      [
        ["2026-01-31", "S1", 10],
        ["2026-01-31", "S2", 500],
        ["2026-02-28", "S1", 30],
        ["2026-02-28", "S2", 600],
        ["2026-03-31", "S1", 50],
        ["2026-03-31", "S2", 700],
      ],
    );
    expect((await rules(t)).issues.filter((i) => i.kind === "non_monotone_cumulative")).toEqual([]);
  });
});

describe("year and month tables", () => {
  it("leave months after today's out of the coverage and flag them", async () => {
    const YEAR = { name: "year", label: "Year", letter: "A", type: "integer" } as const;
    const MONTH = { name: "month", label: "Month", letter: "B", type: "integer" } as const;
    const t = table(
      [YEAR, MONTH, { ...AMOUNT, letter: "C" }],
      [
        [2023, 11, 10],
        [2023, 12, 20],
        [2026, 9, 99999],
      ],
    );
    const ws = await Workspace.open();
    open.push(ws);
    await loadTable(ws, t);
    const { periodPartsCoverage } = await import("../src/profile.sql.ts");
    const cov = await ws.one<{ first: string; last: string }>(periodPartsCoverage("t_t1", "year", "month", "2024-01-01"));
    expect(cov).toEqual({ first: "2023-11-01", last: "2023-12-01" });
    const profile = await profileTable(ws, t);
    const roles = await detectRoles(ws, t, profile);
    const issues = await runRules(ws, t, profile, "2024-01-01", { roles });
    const f = issues.filter((i) => i.kind === "future_date");
    expect(f.map((i) => [i.column, i.rows, i.details.left_out])).toEqual([["year", [4], true]]);
  });
});
