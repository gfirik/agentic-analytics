// concentration.v1 and dependence.v1 over exact member totals (analysis-library §11.4), with hand-computed series.
import { describe, expect, it } from "vitest";
import { concentration, concentrationTrend, dependence, type Member, type Series } from "../src/index.ts";

const periods = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];
const total: Series = { id: "revenue", metric: "revenue", unit: "currency", points: [] };
const serie = (key: string, ys: number[]): Series => ({
  id: `revenue|customer=${key}`,
  metric: "revenue",
  unit: "currency",
  member: { dimension: "customer", value: key },
  points: periods.map((period, i) => ({ period, value: ys[i] as number })),
});
const perPeriod = (series: Record<string, number[]>) =>
  new Map<string, Member[]>(periods.map((p, i) => [p, Object.entries(series).map(([key, ys]) => ({ key, total: ys[i] as number }))]));

const input = (series: Record<string, number[]>, top: string) => {
  const per = perPeriod(series);
  return {
    metric: "revenue",
    total,
    dimension: "customer",
    dim: "customer",
    period: "2026-05",
    start: "2026-01",
    startShare: undefined as number | undefined,
    members: per.get("2026-05") ?? [],
    trend: concentrationTrend(per, periods),
    top: serie(top, series[top] as number[]),
  };
};

describe("concentration.v1", () => {
  it("is material at a top-1 share of 30% or an HHI of 0.25, over positive keyed members only", () => {
    // 60, 40 → 60%, HHI 0.52; the null key and the refund do not count as members
    const c = concentration("revenue", total, "customer", "2026-05", [
      { key: "A", total: 60 },
      { key: "B", total: 40 },
      { key: null, total: 500 },
      { key: "C", total: -9 },
    ]);
    expect(c?.material).toBe(true);
    expect(c?.details).toMatchObject({ top: "A", members: 2 });
    // ten equal members: 10% each, HHI 0.1: not material
    const even = Array.from({ length: 10 }, (_, i) => ({ key: `m${i}`, total: 10 }));
    expect(concentration("revenue", total, "customer", "2026-05", even)?.material).toBe(false);
    // one member is not a distribution
    expect(concentration("revenue", total, "customer", "2026-05", [{ key: "A", total: 5 }])).toBeUndefined();
  });
});

describe("dependence.v1", () => {
  it("fires when the top member's own value shrinks (100, 90, 80, 70, 60: slope −10, p 0.0275) though its share is high", () => {
    const d = dependence(input({ A: [100, 90, 80, 70, 60], B: [20, 20, 20, 20, 20], C: [20, 20, 20, 20, 20] }, "A"));
    expect(d?.details).toMatchObject({ top: "A", crossing: false, shrinking: true });
    expect(d?.calcs.find((c) => c.name === "member_slope")?.value).toBeCloseTo(-10, 12);
    expect(d?.calcs.find((c) => c.name === "member_p")?.value).toBeCloseTo(0.0275, 4);
    // the HHI falls (0.551 → 0.44), so no crossing
    expect(d?.roles.share_start).toBeUndefined();
  });

  it("does not fire when the top member grows from a share that was already above 30%", () => {
    const i = input({ A: [60, 70, 80, 90, 100], B: [20, 20, 20, 20, 20], C: [20, 20, 20, 20, 20] }, "A");
    expect(dependence({ ...i, startShare: 60 })).toBeUndefined();
  });

  it("fires on a crossing: the share was 26.67% at the start of the year and the HHI rises every period", () => {
    // A 24, 42, 60, 84, 108; B, C, D (120 − A) ÷ 3 each: HHI 0.2533, 0.2633, 0.3333, 0.52, 0.8133
    const rest = [32, 26, 20, 12, 4];
    const i = input({ A: [24, 42, 60, 84, 108], B: rest, C: rest, D: rest }, "A");
    const d = dependence({ ...i, startShare: (32 / 120) * 100 });
    expect(d?.details).toMatchObject({ crossing: true, shrinking: false });
    expect(d?.calcs.find((c) => c.name === "hhi_slope")?.value).toBeCloseTo(0.1341667, 6);
  });

  it("does not fire below a 30% top share", () => {
    const even = { A: [10, 10, 10, 10, 10], B: [10, 10, 10, 10, 10], C: [10, 10, 10, 10, 10], D: [10, 10, 10, 10, 10] };
    expect(dependence({ ...input(even, "A"), startShare: 20 })).toBeUndefined();
  });
});
