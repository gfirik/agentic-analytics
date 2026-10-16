import { describe, expect, it } from "vitest";
import { hhi, mad, mannKendall, mean, median, normalCdf, robustZ, sse, theilSen, twoProportionZ } from "../src/stats.ts";

describe("stats (hand-computed)", () => {
  it("mean, median, MAD, robust z", () => {
    expect(mean([2, 4, 9])).toBe(5); // 15 / 3
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5); // (2 + 3) / 2
    // [10, 11, 12, 13, 100]: median 12; |dev| = 2, 1, 0, 1, 88 → median 1
    expect(mad([10, 12, 11, 13, 100])).toBe(1);
    // (100 − 12) / (1.4826 × 1) = 59.355…
    expect(robustZ(100, 12, 1)).toBeCloseTo(59.3552, 3);
    expect(robustZ(5, 5, 0)).toBeNaN();
  });

  it("Theil–Sen slope", () => {
    expect(theilSen([1, 2, 3, 4, 5])).toBe(1);
    // [10, 12, 11, 15] pair slopes: 2, 0.5, 5/3, −1, 1.5, 4 → sorted −1, 0.5, 1.5, 1.667, 2, 4 → median (1.5 + 1.667) / 2 = 1.5833
    expect(theilSen([10, 12, 11, 15])).toBeCloseTo(1.583333, 5);
  });

  it("normal CDF", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("Mann–Kendall on a strictly increasing series", () => {
    // n = 5: S = 10 (all 10 pairs rise); Var = 5·4·15 / 18 = 16.667; Z = (10 − 1) / √16.667 = 2.2045; p = 2(1 − Φ(2.2045)) = 0.0275
    const mk = mannKendall([1, 2, 3, 4, 5]);
    expect(mk.s).toBe(10);
    expect(mk.variance).toBeCloseTo(16.6667, 3);
    expect(mk.z).toBeCloseTo(2.2045, 3);
    expect(mk.p).toBeCloseTo(0.0275, 3);
  });

  it("Mann–Kendall tie correction", () => {
    // [1, 2, 2, 3]: S = 1+1+1+0+1+1 = 5; one tie group of 2 → Var = (4·3·13 − 2·1·9) / 18 = (156 − 18) / 18 = 7.6667
    const mk = mannKendall([1, 2, 2, 3]);
    expect(mk.s).toBe(5);
    expect(mk.variance).toBeCloseTo(7.6667, 3);
  });

  it("two-proportion z-test", () => {
    // 12/1000 vs 34/1000: pooled 46/2000 = 0.023; se = √(0.023 · 0.977 · 0.002) = 0.0067039; z = 0.022 / 0.0067039 = 3.2817
    const t = twoProportionZ(12, 1000, 34, 1000);
    expect(t.z).toBeCloseTo(3.2817, 3);
    expect(t.p).toBeCloseTo(0.00103, 4);
  });

  it("HHI and SSE", () => {
    expect(hhi([0.5, 0.3, 0.2])).toBeCloseTo(0.38, 12); // 0.25 + 0.09 + 0.04
    expect(sse([1, 2, 3])).toBe(2); // mean 2: 1 + 0 + 1
  });
});
