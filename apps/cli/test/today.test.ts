// `--today` is checked before a job starts (analyze, metrics, run).
import { describe, expect, it } from "vitest";
import { todayOf, todayProblem } from "../src/today.ts";

describe("--today", () => {
  it("refuses a date off the calendar with a one-line reason", () => {
    expect(todayProblem("2026-13-45")).toBe('--today "2026-13-45" is not a calendar date; give YYYY-MM-DD, e.g. 2026-07-01');
    expect(todayProblem("2026-02-30")).toMatch(/not a calendar date/);
    expect(todayProblem("1/7/2026")).toMatch(/not a calendar date/);
  });

  it("accepts a real date or none, and defaults to the current UTC date", () => {
    expect(todayProblem("2024-02-29")).toBeUndefined();
    expect(todayProblem(undefined)).toBeUndefined();
    expect(todayOf(undefined, () => new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-01");
    expect(todayOf("2026-03-04")).toBe("2026-03-04");
  });
});
