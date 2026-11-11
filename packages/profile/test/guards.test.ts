// Backtest pre-tag 4 (data-quality guards): rows dated after today are not history; a negative sales amount and a
// falling cumulative column are flagged (ingestion spec §5). Hand-computed expectations.
import { loadTable, type NormalizedTable, Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import { detectRoles, profileTable, runRules } from "../src/index.ts";

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

async function rules(t: NormalizedTable, today = "2026-07-01") {
  const ws = await Workspace.open();
  open.push(ws);
  await loadTable(ws, t);
  const profile = await profileTable(ws, t, "day", today);
  const roles = await detectRoles(ws, t, profile);
  return { profile, issues: await runRules(ws, t, profile, today, roles, "day") };
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
