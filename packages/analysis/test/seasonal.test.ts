// Seasonal baselines: a spike that recurs in the same month a year apart is seasonal; a one-off spike and a level
// shift are not. Hand-built series.
import { describe, expect, it } from "vitest";
import { type Series, seasonalMatch } from "../src/index.ts";

const months = (n: number, start = 2024 * 12 + 6) =>
  Array.from({ length: n }, (_, i) => {
    const m = start + i;
    return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
  });
const series = (values: number[]): Series => {
  const ps = months(values.length); // 2024-07 …
  return { id: "s", metric: "s", unit: "currency", points: values.map((value, i) => ({ period: ps[i] as string, value })) };
};

describe("seasonalMatch", () => {
  // 2024-07 … 2026-06; Decembers are indexes 5 and 17.
  const flat = Array.from({ length: 24 }, () => 100);

  it("both Decembers 25% above their neighbours: each is seasonal, matched by the other", () => {
    const v = [...flat];
    v[5] = 125;
    v[17] = 125;
    // 125 / mean(100, 100) − 1 = +25% ≥ 8%, and the other December is +25% ≥ 50% of it.
    expect(seasonalMatch(series(v), "2024-12", "month")).toEqual(["2025-12"]);
    expect(seasonalMatch(series(v), "2025-12", "month")).toEqual(["2024-12"]);
  });

  it("a one-off spike is not seasonal; a weaker spike a year apart (below half) doesn't make it one", () => {
    const v = [...flat];
    v[5] = 125;
    v[17] = 110; // +10% < 50% of +25%
    expect(seasonalMatch(series(v), "2024-12", "month")).toBeUndefined();
    const once = [...flat];
    once[5] = 125;
    expect(seasonalMatch(series(once), "2024-12", "month")).toBeUndefined();
  });

  it("a level shift is never seasonal, even when it starts in the same month each year", () => {
    // A step down at 2025-04 that stays: 2025-04 sits between 100 and 80, so it is not a spike.
    const v = flat.map((x, i) => (i >= 9 ? 80 : x));
    expect(seasonalMatch(series(v), "2025-04", "month")).toBeUndefined();
  });

  it("is undefined at a grain without a calendar year (days)", () => {
    const v = [...flat];
    v[5] = 125;
    v[17] = 125;
    expect(seasonalMatch(series(v), "2024-12", "day")).toBeUndefined();
  });

  it("a change measured against a seasonal peak touches the season (January after a December peak)", async () => {
    const { touchesSeason } = await import("../src/index.ts");
    const v = [...flat];
    v[5] = 125;
    v[17] = 125;
    // January 2025 compared with December 2024: the comparison point is seasonal.
    expect(touchesSeason(series(v), "2025-01", ["2024-12", "2025-01"], "month")).toBe(true);
    // June compared with May: no season involved.
    expect(touchesSeason(series(v), "2025-06", ["2025-05", "2025-06"], "month")).toBe(false);
  });

  it("a level shift right after a seasonal peak stays a finding (January below November's level)", async () => {
    const { touchesSeason } = await import("../src/index.ts");
    // Decembers 125 in both years; from 2026-01 a customer is gone and the level drops to 70.
    // 2025-12: neighbours 100 and 70, spike 125 / 85 − 1 = +47%; 2024-12 is +25%, 25/47 = 0.53 ∈ [0.5, 2] → seasonal.
    // January 2026 against November 2025 (the level outside the peak): 70 / 100 − 1 = −30%, beyond 8% → real.
    const v = [...flat, 100, 100, 100];
    v[5] = 125;
    v[17] = 125;
    for (let i = 18; i < v.length; i++) v[i] = 70;
    expect(seasonalMatch(series(v), "2025-12", "month")).toEqual(["2024-12"]);
    expect(touchesSeason(series(v), "2026-01", ["2025-12", "2026-01"], "month")).toBe(false);
  });

  it("the newest period is never seasonal: it has no next neighbour, so a drop there may be a shift", () => {
    // 27 months, 2024-07 … 2026-09; the last one dips like 2025-09 did.
    const v = [...flat, 100, 100, 100];
    v[14] = 85; // 2025-09: 85 / 100 − 1 = −15%
    v[26] = 70; // 2026-09, the newest: one-sided, no verdict
    expect(seasonalMatch(series(v), "2026-09", "month")).toBeUndefined();
  });

  it("a match is bounded on both sides: +25% against +100% a year earlier is a seasonal shortfall, not the season", () => {
    const v = [...flat];
    v[5] = 200; // 2024-12: +100%
    v[17] = 125; // 2025-12: +25%; 100/25 = 4 > 2 → no match; and 25/100 = 0.25 < 0.5 the other way round
    expect(seasonalMatch(series(v), "2025-12", "month")).toBeUndefined();
    expect(seasonalMatch(series(v), "2024-12", "month")).toBeUndefined();
  });

  it("matches by calendar label, not position: a missing month doesn't pair November with December", () => {
    const v = [...flat];
    v[5] = 125;
    v[17] = 125;
    const s = series(v);
    // Drop 2025-06 from the series: by position, index 5 + 12 would now be 2026-01.
    const gap: Series = { ...s, points: s.points.filter((p) => p.period !== "2025-06") };
    expect(seasonalMatch(gap, "2024-12", "month")).toEqual(["2025-12"]);
  });

  it("weeks and quarters match the same label in another year", () => {
    const q = (labels: string[], values: number[]): Series => ({
      id: "q",
      metric: "q",
      unit: "count",
      points: labels.map((period, i) => ({ period, value: values[i] as number })),
    });
    const quarters = ["2024-Q3", "2024-Q4", "2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1"];
    // Q4s at 130 between 100s: +30% each.
    expect(seasonalMatch(q(quarters, [100, 130, 100, 100, 100, 130, 100]), "2025-Q4", "quarter")).toEqual(["2024-Q4"]);
  });
});
