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
});
