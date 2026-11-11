// The note on an empty recommendations section after VERIFY (report-schema §1, pre-tag 3): recomputed from what
// shipped, so a note DECIDE set can never survive next to a recommendation, with no findings, or with no numbers.
import type { Report } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import { noteAfterVerify } from "../src/verify.ts";

const draft = (o: { recs?: number; note?: Report["recommendations_note"]; noNumbers?: boolean }): Report =>
  ({
    summary: { headline: "h", bullets: [], ...(o.noNumbers ? { no_numbers: "no_table" } : {}) },
    recommendations: Array.from({ length: o.recs ?? 0 }, (_, i) => ({ id: `R${i + 1}` })),
    ...(o.note ? { recommendations_note: o.note } : {}),
  }) as unknown as Report;

describe("noteAfterVerify", () => {
  it("drafted recommendations that VERIFY drops entirely read as none passed", () => {
    expect(noteAfterVerify(draft({ recs: 2 }), 3, 0)).toEqual({ recommendations_note: "none_passed" });
  });
  it("keeps the note DECIDE set when it drafted nothing", () => {
    expect(noteAfterVerify(draft({ note: "step_failed" }), 3, 0)).toEqual({ recommendations_note: "step_failed" });
  });
  it("clears any note once a recommendation shipped", () => {
    expect(noteAfterVerify(draft({ recs: 2, note: "none_passed" }), 3, 1)).toEqual({});
  });
  it("clears the note when VERIFY dropped every finding", () => {
    expect(noteAfterVerify(draft({ note: "step_failed" }), 0, 0)).toEqual({});
  });
  it("never sets a note next to no numbers", () => {
    expect(noteAfterVerify(draft({ recs: 1, note: "step_failed", noNumbers: true }), 2, 0)).toEqual({});
  });
});
