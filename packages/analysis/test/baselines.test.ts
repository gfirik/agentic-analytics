import { describe, expect, it } from "vitest";
import { chooseBaseline, materiality, noiseBand } from "../src/baselines.ts";

const series = (values: number[], start = 1) => values.map((value, i) => ({ period: `2026-${String(start + i).padStart(2, "0")}`, value }));
// coffee-roaster monthly revenue, Jan–Jun 2026
const REVENUE = series([41200, 42900, 44100, 36200, 35800, 37000]);

describe("baselines (spec §2)", () => {
  it("uses the previous period when there are fewer than 13 months", () => {
    expect(chooseBaseline(REVENUE, 3)).toEqual({ method: "previous_period", value: 44100, periods: ["2026-03"] });
  });

  it("uses the same month last year with 13+ months", () => {
    const long = Array.from({ length: 14 }, (_, i) => ({ period: `p${i}`, value: 100 + i }));
    // target index 13 → index 1 a year earlier (value 101)
    expect(chooseBaseline(long, 13)).toEqual({ method: "same_period_last_year", value: 101, periods: ["p1"] });
  });

  it("falls back to the trailing mean of 3 when the previous period is missing", () => {
    const gap = [...series([10, 20, 30]), { period: "2026-04", value: Number.NaN }, { period: "2026-05", value: 99 }];
    // previous (2026-04) is NaN; trailing [20, 30, NaN] has only 2 finite values → no baseline
    expect(chooseBaseline(gap, 4)).toBeUndefined();
    const gap2 = [...series([10, 20, 30]), { period: "2026-04", value: Number.NaN }];
    // target 2026-04's previous is 30 → previous_period
    expect(chooseBaseline(gap2, 3)?.method).toBe("previous_period");
  });
});

describe("noise band and materiality (spec §2)", () => {
  it("MAD band leaves out the change being tested", () => {
    // changes: +1700, +1200, −7900, −400, +1200; without April's −7900: [1700, 1200, −400, 1200]
    // median 1200; |dev| = 500, 0, 1600, 0 → MAD = median(0, 0, 500, 1600) = 250; band = 2 × 1.4826 × 250 = 741.3
    expect(noiseBand(REVENUE, 3)).toBeCloseTo(741.3, 6);
  });

  it("needs 6+ periods for a band", () => {
    expect(noiseBand(REVENUE.slice(0, 5), 3)).toBeUndefined();
  });

  it("April's revenue drop is material on all three tests", () => {
    // Δ = −7,900; Δ% = −17.91; mean = 237,200 / 6 = 39,533 → 1% = 395.3
    const m = materiality(-7900, -17.913832, 741.3, 237200 / 6);
    expect(m).toEqual({ material: true, passesBand: true, passesPct: true, passesAbs: true });
  });

  it("March's rise (+1,200, +2.8%) is not material (planted distractor D1)", () => {
    // without March's change: [1700, −7900, −400, 1200] → median 400; |dev| 1300, 8300, 800, 800 → MAD 1050 → band 3113.5
    expect(materiality(1200, 2.797, noiseBand(REVENUE, 2), 237200 / 6).material).toBe(false);
  });

  it("without a band, only % and absolute tests apply and confidence is capped", () => {
    expect(materiality(-50, -10, undefined, 500)).toEqual({
      material: true,
      passesBand: null,
      passesPct: true,
      passesAbs: true,
      confidenceCap: "medium",
    });
    expect(materiality(-3, -4, undefined, 500).material).toBe(false); // −4% < 5%
  });
});
