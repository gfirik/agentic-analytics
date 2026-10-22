// The `_period` key written at load (profile's periodOf, in JS) and the period the metric SQL groups by
// (periodExpr, in DuckDB) must agree: the quality guard compares one with the other (analysis quality-guard.ts).
import { periodOf } from "@agentic-analytics/profile";
import type { Grain } from "@agentic-analytics/schema";
import { Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import { periodExpr } from "../src/index.ts";

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});

// Year-boundary ISO weeks (2020-12-31 is 2020-W53, 2021-01-03 is still 2020-W53, 2024-12-30 is 2025-W01), quarter
// edges and a leap day.
const DATES = [
  "2020-12-31",
  "2021-01-01",
  "2021-01-03",
  "2021-01-04",
  "2024-02-29",
  "2024-03-31",
  "2024-04-01",
  "2024-12-29",
  "2024-12-30",
  "2025-12-31",
  "2026-01-01",
  "2026-06-30",
  "2026-07-01",
];
const VALUES = DATES.map((d) => `(DATE '${d}')`).join(", ");
const GRAINS: Grain[] = ["day", "week", "month", "quarter", "year"];

describe("periodOf and periodExpr", () => {
  it("give the same key for every grain", async () => {
    const ws = await Workspace.open();
    open.push(ws);
    for (const grain of GRAINS) {
      const rows = await ws.all<{ d: string; p: string }>({
        // The dates are this file's constants, not input.
        text: `SELECT strftime(d, '%Y-%m-%d') AS d, ${periodExpr("d", grain)} AS p FROM (VALUES ${VALUES}) AS v(d) ORDER BY d`,
        params: [],
      });
      expect(rows.map((r) => [r.d, r.p])).toEqual(DATES.map((d) => [d, periodOf(d, grain)]));
    }
  });

  it("names year-boundary weeks by their ISO week-year", () => {
    expect(periodOf("2021-01-03", "week")).toBe("2020-W53");
    expect(periodOf("2024-12-30", "week")).toBe("2025-W01");
  });
});
