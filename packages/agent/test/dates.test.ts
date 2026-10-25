// Date filters a real planner sends (STATE [Nightly results, 2026-10-25]): hand-written cases, no model.
import { describe, expect, it } from "vitest";
import { normaliseDateFilter } from "../src/index.ts";

const ok = (raw: string | undefined, edge: "from" | "to") => {
  const r = normaliseDateFilter(raw, edge);
  if (!r.ok) throw new Error(r.error);
  return r.date;
};

describe("normaliseDateFilter", () => {
  it("treats empty and blank as absent", () => {
    expect(ok("", "from")).toBeUndefined();
    expect(ok("  ", "to")).toBeUndefined();
    expect(ok(undefined, "to")).toBeUndefined();
  });
  it("widens a month to its first day for from, its last for to, with correct month lengths", () => {
    expect(ok("2020-03", "from")).toBe("2020-03-01");
    expect(ok("2020-03", "to")).toBe("2020-03-31");
    expect(ok("2020-04", "to")).toBe("2020-04-30");
    expect(ok("2024-02", "to")).toBe("2024-02-29");
    expect(ok("2023-02", "to")).toBe("2023-02-28");
    expect(ok("1900-02", "to")).toBe("1900-02-28"); // divisible by 100, not 400
    expect(ok("2000-02", "to")).toBe("2000-02-29");
    expect(ok("2020-12", "to")).toBe("2020-12-31");
  });
  it("widens a year to Jan 1 / Dec 31", () => {
    expect(ok("2020", "from")).toBe("2020-01-01");
    expect(ok("2020", "to")).toBe("2020-12-31");
  });
  it("leaves a real full date unchanged", () => {
    expect(ok("2020-03-15", "from")).toBe("2020-03-15");
    expect(ok("2024-02-29", "to")).toBe("2024-02-29");
  });
  it("returns a readable error, not a throw, for anything else", () => {
    for (const bad of ["2020-13", "2020-00", "03/2020", "2020-3", "March 2026", "2023-02-29", "2026-13-45", "20-03", "2020-03-1"]) {
      const r = normaliseDateFilter(bad, "from");
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error).toContain("YYYY-MM-DD");
    }
  });
});
