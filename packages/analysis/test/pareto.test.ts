// Pareto classes, top-N shares, the HHI and the windows they run over, with the hand computations of
// docs/specs/analysis-library.md §11 (the same figures PR 9's V2 and pipeline tests use).
import { describe, expect, it } from "vitest";
import {
  allStats,
  classes,
  concentrationTrend,
  curve,
  type Member,
  mannKendall,
  statValue,
  theilSen,
  trailingWindows,
} from "../src/index.ts";
import { calendarYear, completeYears, shiftPeriod } from "../src/windows.ts";

const members = (...totals: number[]): Member[] => totals.map((total, i) => ({ key: `m${i + 1}`, total }));

describe("pareto.v1 on 50, 30, 10, 6, 4", () => {
  const m = members(50, 30, 10, 6, 4);

  it("the cumulative shares are 50, 80, 90, 96, 100 and the classes A A B C C", () => {
    const c = curve(m);
    const cumulative = c.positive.map((_, i) => c.positive.slice(0, i + 1).reduce((a, x) => a + x.total, 0) / c.total);
    expect(cumulative).toEqual([0.5, 0.8, 0.9, 0.96, 1]);
    expect(classes(c.positive, c.total)).toEqual(["a", "a", "b", "c", "c"]);
  });

  it("A holds 2 members and 80, B 1 member and 10, C 2 members and 10", () => {
    const s = allStats(m);
    expect([s.get("a_count"), s.get("a_value"), s.get("a_share")]).toEqual([2, 80, 80]);
    expect([s.get("b_count"), s.get("b_value"), s.get("b_share")]).toEqual([1, 10, 10]);
    expect([s.get("c_count"), s.get("c_value"), s.get("c_share")]).toEqual([2, 10, 10]);
    expect(s.get("members")).toBe(5);
  });

  it("top-3 share is 90% and the HHI is 0.3552; top-5 and top-10 are not stated (5 members is not more than 5)", () => {
    expect(statValue("top3_share", m)).toBeCloseTo(90, 12);
    expect(statValue("top1_share", m)).toBe(50);
    // 0.25 + 0.09 + 0.01 + 0.0036 + 0.0016
    expect(statValue("hhi", m)).toBeCloseTo(0.3552, 12);
    expect(statValue("top5_share", m)).toBeUndefined();
    expect(statValue("top10_share", m)).toBeUndefined();
  });

  it("a member of −5 is left out of the curve and counted on its own; a row with no key is stated, not ranked", () => {
    const withLoss = [...m, { key: "loss", total: -5 }, { key: null, total: 7 }];
    expect(statValue("a_count", withLoss)).toBe(2);
    expect(statValue("members", withLoss)).toBe(5);
    expect(statValue("nonpositive_count", withLoss)).toBe(1);
    expect(statValue("nonpositive_value", withLoss)).toBe(-5);
    expect(statValue("unkeyed_value", withLoss)).toBe(7);
    expect(statValue("top1_share", withLoss)).toBe(50);
  });
});

describe("class edges", () => {
  it("85, 10, 5 give 85 (A, the first member), 95 (B, since 95 ≤ 95) and 100 (C)", () => {
    const c = curve(members(85, 10, 5));
    expect(classes(c.positive, c.total)).toEqual(["a", "b", "c"]);
  });

  it("a member that holds more than 80% alone is still class A; the next reaches 100%, so it is C", () => {
    expect(classes(curve(members(90, 10)).positive, 100)).toEqual(["a", "c"]);
  });

  it("a member that reaches 80% only up to floating-point noise lands on the lower class", () => {
    // 0.4000000000000001 + 0.4 = 0.8000000000000002, 80.00000000000001 percent of a total of exactly 1.
    const positive = [
      { key: "a", total: 0.4000000000000001 },
      { key: "b", total: 0.4 },
      { key: "c", total: 0.2 },
    ];
    expect(classes(positive, 1)).toEqual(["a", "a", "c"]);
  });

  it("ties are ordered by key", () => {
    const c = curve([
      { key: "b", total: 5 },
      { key: "a", total: 5 },
    ]);
    expect(c.positive.map((x) => x.key)).toEqual(["a", "b"]);
  });
});

describe("the concentration trend", () => {
  it("HHI 0.20, 0.22, 0.25, 0.27, 0.30 has Theil–Sen slope 0.025 and Mann–Kendall p 0.0275", () => {
    const hhi = [0.2, 0.22, 0.25, 0.27, 0.3];
    expect(theilSen(hhi)).toBeCloseTo(0.025, 12);
    // S = 10, Var = 5·4·15 ÷ 18 = 16.667, z = 9 ÷ 4.0825 = 2.2045
    expect(mannKendall(hhi).p).toBeCloseTo(0.0275, 4);
  });

  it("is read from the latest periods that have a positive member, in order", () => {
    const per = new Map<string, Member[]>([
      ["2026-01", members(5, 5)],
      ["2026-02", []],
      ["2026-03", members(6, 4)],
    ]);
    const t = concentrationTrend(per, ["2026-01", "2026-02", "2026-03"]);
    expect(t.periods).toEqual(["2026-01", "2026-03"]);
    expect(t.hhi[0]).toBeCloseTo(0.5, 12);
    expect(t.top1[1]).toBeCloseTo(60, 12);
  });
});

describe("windows", () => {
  it("the trailing year at month grain, and the year before when the data covers it", () => {
    expect(trailingWindows("2023-01", "2026-03", "month")).toEqual({
      ttm: { from: "2025-04", to: "2026-03" },
      ttmPrev: { from: "2024-04", to: "2025-03" },
    });
    // 20 months: the year before is only partly covered, so it is not stated
    expect(trailingWindows("2024-08", "2026-03", "month")).toEqual({ ttm: { from: "2025-04", to: "2026-03" } });
    // shorter than a year: the whole range
    expect(trailingWindows("2026-01", "2026-05", "month")).toEqual({ ttm: { from: "2026-01", to: "2026-05" } });
  });

  it("the same calendar span at the other grains", () => {
    expect(trailingWindows("2020-Q1", "2026-Q2", "quarter").ttm).toEqual({ from: "2025-Q3", to: "2026-Q2" });
    expect(trailingWindows("2020", "2026", "year").ttm).toEqual({ from: "2026", to: "2026" });
    expect(trailingWindows("2024-01-01", "2026-03-10", "day").ttm).toEqual({ from: "2025-03-11", to: "2026-03-10" });
    // 52 weeks ending 2026-W10 start at 2025-W11
    expect(trailingWindows("2020-W01", "2026-W10", "week").ttm).toEqual({ from: "2025-W11", to: "2026-W10" });
  });

  it("shifts across year ends", () => {
    expect(shiftPeriod("2026-01", "month", -1)).toBe("2025-12");
    expect(shiftPeriod("2025-Q4", "quarter", 1)).toBe("2026-Q1");
    expect(shiftPeriod("2026-03-01", "day", -1)).toBe("2026-02-28");
    // 2020 has 53 ISO weeks
    expect(shiftPeriod("2021-W01", "week", -1)).toBe("2020-W53");
  });

  it("the complete calendar years of the data", () => {
    expect(completeYears("2023-04", "2026-03", "month").map(([y]) => y)).toEqual([2024, 2025]);
    expect(calendarYear(2025, "quarter")).toEqual({ from: "2025-Q1", to: "2025-Q4" });
    expect(completeYears("2020", "2026", "year")).toEqual([]);
  });
});
