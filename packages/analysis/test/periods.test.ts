// fillPeriods: hand-checked series with gaps (analysis-library §1).
import { describe, expect, it } from "vitest";
import { fillPeriods } from "../src/periods.ts";
import { periodChange } from "../src/templates.ts";
import type { Series } from "../src/types.ts";

const periods = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];

describe("fillPeriods", () => {
  it("a member with no rows in February is 0 there, so March is compared with February, not January", () => {
    const pts = fillPeriods(
      [
        { period: "2026-01", value: 500 },
        { period: "2026-03", value: 700 },
      ],
      periods,
      true,
      periods.map((period) => ({ period })),
    );
    expect(pts.map((p) => p.value)).toEqual([500, 0, 700, 0, 0, 0]);
  });

  it("an average with a missing month is unknown there (NaN), and nothing is added outside the metric's span", () => {
    const pts = fillPeriods(
      [
        { period: "2026-03", value: 20 },
        { period: "2026-05", value: 24 },
      ],
      periods,
      false,
    );
    expect(pts.map((p) => p.period)).toEqual(["2026-03", "2026-04", "2026-05"]);
    expect(pts[1]?.value).toBeNaN();
  });

  it("period_change on a filled series: May → June uses May's 0, not April's value", () => {
    // Rows in Apr (300) and Jun (450), none in May. Unfilled, June would be compared with April (+150).
    const points = fillPeriods(
      [
        { period: "2026-04", value: 300 },
        { period: "2026-06", value: 450 },
      ],
      periods,
      true,
      periods.map((period) => ({ period })),
    );
    const s: Series = { id: "m|store=a", metric: "m", unit: "count", member: { dimension: "store", value: "a" }, points };
    const i = periodChange(s);
    expect(i?.roles.before).toEqual({ kind: "point", series: "m|store=a", period: "2026-05" });
    expect(i?.calcs.find((c) => c.name === "change")?.value).toBe(450);
    // From a base of 0 there is no percent change.
    expect(i?.roles.change_pct).toBeUndefined();
  });
});
