// The shared YYYY-MM-DD check for dates a person gives (API `today`, CLI `--today`, `aa usage --day`).
import { describe, expect, it } from "vitest";
import { isCalendarDate } from "../src/index.ts";

describe("isCalendarDate", () => {
  it("accepts real dates, leap days included", () => {
    for (const d of ["2026-07-01", "2024-02-29", "2000-02-29", "2026-12-31"]) expect(isCalendarDate(d)).toBe(true);
  });

  it("refuses dates off the calendar and other shapes", () => {
    for (const d of ["2026-13-45", "2026-02-30", "2025-02-29", "1900-02-29", "2026-04-31", "2026-00-10", "2026-7-1", "20260701", ""])
      expect(isCalendarDate(d)).toBe(false);
  });
});
