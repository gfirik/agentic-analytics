import { describe, expect, it } from "vitest";
import { dateOrderEvidence, detectDateOrder, monthNumber, parseDate, serialToDate } from "../src/index.ts";

describe("parseDate (spec §6 formats)", () => {
  it.each([
    ["2026-03-15", "dmy", "2026-03-15"],
    ["2026-03-15T09:30", "dmy", "2026-03-15 09:30:00"],
    ["2026/3/5", "dmy", "2026-03-05"],
    ["2026-03", "dmy", "2026-03-01"],
    ["15.03.2026", "dmy", "2026-03-15"],
    ["04/03/2026", "dmy", "2026-03-04"],
    ["04/03/2026", "mdy", "2026-04-03"],
    ["4-3-26", "dmy", "2026-03-04"],
    ["Jan 2026", "dmy", "2026-01-01"],
    ["15 March 2026", "dmy", "2026-03-15"],
    ["March 15, 2026", "dmy", "2026-03-15"],
    ["15 марта 2026 г.", "dmy", "2026-03-15"],
    ["январь 2026", "dmy", "2026-01-01"],
    ["yanvar 2026", "dmy", "2026-01-01"],
    ["12 iyul 2026", "dmy", "2026-07-12"],
  ] as const)("%s (%s) → %s", (raw, order, iso) => {
    expect(parseDate(raw, order)?.iso).toBe(iso);
  });

  it("rejects impossible and non-dates", () => {
    expect(parseDate("31/02/2026")).toBeUndefined();
    expect(parseDate("13/13/2026")).toBeUndefined();
    expect(parseDate("Espresso blend")).toBeUndefined();
    expect(parseDate("12")).toBeUndefined();
  });

  it("reads Excel serials", () => {
    // serial 46082 = 2026-03-01 (days since 1899-12-30)
    expect(serialToDate(46082)?.iso).toBe("2026-03-01");
    expect(serialToDate(12)).toBeUndefined();
  });

  it("knows month names in EN/RU/UZ", () => {
    expect([monthNumber("Sept."), monthNumber("мая"), monthNumber("dekabr"), monthNumber("foo")]).toEqual([9, 5, 12, undefined]);
  });
});

describe("dd/mm vs mm/dd (majority test per column)", () => {
  it("classifies single values", () => {
    expect(dateOrderEvidence("13/03/2026")).toBe("dmy");
    expect(dateOrderEvidence("03/13/2026")).toBe("mdy");
    expect(dateOrderEvidence("04/03/2026")).toBe("ambiguous");
    expect(dateOrderEvidence("03/03/2026")).toBe("either");
    expect(dateOrderEvidence("2026-03-04")).toBeUndefined();
  });

  it("resolves a column by any value above 12", () => {
    // 2 ambiguous + 1 decisive day-first value → day-first, not assumed
    expect(detectDateOrder(["04/03/2026", "05/03/2026", "25/03/2026"])).toEqual({
      order: "dmy",
      ambiguous: 2,
      dmy: 1,
      mdy: 0,
      assumed: false,
      conflict: false,
    });
    expect(detectDateOrder(["04/03/2026", "03/25/2026"]).order).toBe("mdy");
  });

  it("same-day-and-month values are no evidence either way", () => {
    expect(detectDateOrder(["01.03.2026", "02.03.2026", "03.03.2026"])).toMatchObject({ ambiguous: 2, dmy: 0, mdy: 0, assumed: true });
  });

  it("flags an unresolved column as an assumption and a mixed one as a conflict", () => {
    expect(detectDateOrder(["04/03/2026", "05/06/2026"])).toMatchObject({ order: "dmy", assumed: true });
    expect(detectDateOrder(["25/03/2026", "03/25/2026"])).toMatchObject({ conflict: true });
  });
});
