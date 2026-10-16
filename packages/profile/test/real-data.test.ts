// What the real-data eval tier (evals/real) found missing: `year.month` periods (Stats NZ CSVs), invoice numbers
// with a cancellation prefix, missing customer IDs, missing values, and a last month the data stops early in.
// Every expected value is counted by hand from the small files below.
import { ingest } from "@agentic-analytics/ingest";
import { sql, Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import { inferColumn, normalizeCell, partialLastMonth, previousMonth, profileJob, yearMonthOf } from "../src/index.ts";

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});
const csv = (name: string, text: string) => [{ name, bytes: new TextEncoder().encode(text) }];
const profiled = async (name: string, text: string) => {
  const ws = await Workspace.open();
  open.push(ws);
  return { ws, summary: await profileJob(ws, await ingest(csv(name, text)), { today: "2026-07-01" }) };
};

// Sheet rows 2–11. Row 5 is a cancellation (C1003, −1); rows 6 and 9 have no customer; row 11 is a negative
// quantity that is not a cancellation.
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

describe("year.month periods", () => {
  it("reads the month from the number's two decimals", () => {
    expect(yearMonthOf(2002.1)).toBe("2002-10-01"); // "2002.10" parsed as a number
    expect(yearMonthOf(2002.01)).toBe("2002-01-01");
    expect(yearMonthOf(2002.12)).toBe("2002-12-01");
    expect(yearMonthOf(2026.09)).toBe("2026-09-01");
    expect(yearMonthOf(2002.13)).toBeUndefined();
    expect(yearMonthOf(2002)).toBeUndefined();
    expect(yearMonthOf(2002.105)).toBeUndefined();
    expect(yearMonthOf(1850.05)).toBeUndefined();
  });

  it("types a date-named column of year.month numbers as dates, and only a date-named one", () => {
    const cells = [2002.1, 2002.11, 2002.12, 2003.01].map((v) => ({ v, t: "n" as const }));
    const inf = inferColumn("Period", cells);
    expect(inf.type).toBe("date");
    expect(cells.map((c) => normalizeCell(c, inf))).toEqual(["2002-10-01", "2002-11-01", "2002-12-01", "2003-01-01"]);
    expect(inferColumn("Ratio", cells).type).toBe("decimal");
  });

  it("profiles a Stats NZ-style CSV by month, and reports its blank values", async () => {
    const { ws, summary } = await profiled(
      "ect.csv",
      "Series_reference,Period,Data_value,STATUS\nX1,2002.09,,C\nX1,2002.10,2182.6,F\nX1,2002.11,2350,F\nX1,2002.12,2701.4,F\n",
    );
    const t = summary.tables[0];
    expect(t?.date_column).toBe("period");
    expect([t?.date_first, t?.date_last]).toEqual(["2002-09-01", "2002-12-01"]);
    expect(t?.grain).toBe("month");
    expect(await ws.all(sql`SELECT _period, data_value FROM t_t1 ORDER BY _row`)).toEqual([
      { _period: "2002-09", data_value: null },
      { _period: "2002-10", data_value: 2182.6 },
      { _period: "2002-11", data_value: 2350 },
      { _period: "2002-12", data_value: 2701.4 },
    ]);
    // One blank of four: reported once, citing sheet row 2.
    expect(summary.issues.filter((i) => i.kind === "missing_value").map((i) => [i.column_name, i.rows, i.details])).toEqual([
      ["data_value", [2], { missing: 1, rows_total: 4 }],
    ]);
  });
});

describe("invoice lines", () => {
  it("keeps prefixed invoice numbers as identifiers and reports cancellations, missing IDs and negative quantities", async () => {
    const { ws, summary } = await profiled("lines.csv", LINES);
    const cols = Object.fromEntries((summary.tables[0]?.columns ?? []).map((c) => [c.name, c.type]));
    expect(cols).toMatchObject({ invoice: "id", quantity: "integer", price: "currency", customer_id: "integer" });
    // C1003 is kept, not emptied as unparseable.
    expect(await ws.one(sql`SELECT invoice FROM t_t1 WHERE _row = 5`)).toEqual({ invoice: "C1003" });
    expect(summary.issues.some((i) => i.kind === "unparseable_value")).toBe(false);
    const by = (kind: string) => summary.issues.filter((i) => i.kind === kind).map((i) => [i.column_name, i.rows, i.details]);
    expect(by("prefixed_id")).toEqual([["invoice", [5], { prefix: "C", count: 1, plain: 9 }]]);
    expect(by("missing_id")).toEqual([["customer_id", [6, 9], { missing: 2, rows_total: 10 }]]);
    expect(summary.issues.filter((i) => i.kind === "negative_quantity").map((i) => i.rows)).toEqual([[5], [11]]);
  });

  it("does not report an optional identifier that is mostly empty", async () => {
    const { summary } = await profiled("refs.csv", "Date,Amount,Ref ID\n2026-01-01,5,\n2026-01-02,6,\n2026-01-03,7,R1\n");
    expect(summary.issues.filter((i) => i.kind === "missing_id")).toEqual([]);
  });
});

describe("partial last month", () => {
  const day = (date_last: string) => [{ date_last, grain: "day" as const }];
  it("flags day-level data that stops before three quarters of its last month", () => {
    expect(partialLastMonth(day("2011-12-09"), "month")).toBe("2011-12"); // 9/31 = 0.29
    expect(partialLastMonth(day("2026-02-20"), "month")).toBe("2026-02"); // 20/28 = 0.71
    expect(partialLastMonth(day("2026-02-21"), "month")).toBeUndefined(); // 21/28 = 0.75
    expect(partialLastMonth(day("2026-06-30"), "month")).toBeUndefined();
  });
  it("never flags monthly data, another grain, or no dates", () => {
    expect(partialLastMonth([{ date_last: "2026-06-01", grain: "month" }], "month")).toBeUndefined();
    expect(partialLastMonth(day("2011-12-09"), "week")).toBeUndefined();
    expect(partialLastMonth([{}], "month")).toBeUndefined();
  });
  it("uses the table with the latest date", () => {
    expect(
      partialLastMonth(
        [
          { date_last: "2011-12-09", grain: "day" },
          { date_last: "2011-11-30", grain: "day" },
        ],
        "month",
      ),
    ).toBe("2011-12");
  });
  it("steps back one month", () => {
    expect(previousMonth("2011-12")).toBe("2011-11");
    expect(previousMonth("2012-01")).toBe("2011-12");
  });
});
