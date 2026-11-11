import { findFreeNumerals } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import { noNumbersHeadline, noNumbersReason } from "../src/summary.ts";

const base = { metricFacts: 0, tables: 0, sources: 0, filesNotRead: 0 };

describe("noNumbersReason", () => {
  it("is undefined once a metric was computed", () => {
    expect(noNumbersReason({ ...base, metricFacts: 1, tables: 1, sources: 1 })).toBeUndefined();
  });
  it("picks the reason from what the job knows", () => {
    expect(noNumbersReason({ ...base, tables: 1, sources: 1 })).toBe("headers_not_recognised");
    expect(noNumbersReason({ ...base, sources: 1 })).toBe("no_table");
    expect(noNumbersReason(base)).toBe("no_table");
    expect(noNumbersReason({ ...base, filesNotRead: 2 })).toBe("files_rejected");
    // A document was read next to the rejected file: the table is what is missing.
    expect(noNumbersReason({ ...base, sources: 1, filesNotRead: 1 })).toBe("no_table");
  });
  it("headlines carry no free numerals and never claim an all-clear", () => {
    for (const r of ["files_rejected", "no_table", "headers_not_recognised"] as const) {
      expect(findFreeNumerals(noNumbersHeadline(r))).toEqual([]);
      expect(noNumbersHeadline(r)).not.toMatch(/No material changes/);
    }
  });
  it("hints at files that were not read when another reason applies", () => {
    expect(noNumbersHeadline("no_table", true)).toBe(
      "No numbers could be read from these files: no table was found (add a spreadsheet or CSV with one header row); some files were not read.",
    );
    expect(noNumbersHeadline("files_rejected", true)).not.toContain("some files were not read");
  });
});
