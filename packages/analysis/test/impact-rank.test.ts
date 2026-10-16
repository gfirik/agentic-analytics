import { describe, expect, it } from "vitest";
import { ImpactError, impactRange } from "../src/impact.ts";
import { insightChange, metricFamily, rankInsights, topForExplain } from "../src/rank.ts";
import { type Insight, periodChange, trendBreak } from "../src/templates.ts";
import type { Series } from "../src/types.ts";

const ref = (name: string) => ({ kind: "calc" as const, name });

describe("impact.v1 (spec §5)", () => {
  it("recover a share of a lost amount, net of the discount (coffee R1)", () => {
    // lost wholesale 8,500; recover 50–90%; 6% discount → 8,500 × 0.5 × 0.94 = 3,995 and 8,500 × 0.9 × 0.94 = 7,191
    const r = impactRange({ type: "recover_share", lost: { ref: ref("lost"), value: -8500 }, low: 0.5, high: 0.9, discount: 0.06 });
    expect([r.low.value, r.high.value]).toEqual([expect.closeTo(3995, 9), expect.closeTo(7191, 9)]);
    expect(r.label).toBe("scenario estimate");
    expect(r.params.map((p) => [p.name, p.value])).toEqual([
      ["param_low", 50],
      ["param_high", 90],
      ["param_cost", 6],
    ]);
    expect(r.low.inputs).toEqual([ref("lost"), ref("param_cost"), ref("param_low")]);
  });

  it("remove an excess rate (coffee R2)", () => {
    // (3.4 − 1.2) / 100 × 37,000 = 814; half to all of it → 407 … 814
    const r = impactRange({
      type: "remove_excess_rate",
      current: { ref: ref("jun"), value: 3.4 },
      baseline: { ref: ref("mar"), value: 1.2 },
      base: { ref: ref("rev"), value: 37000 },
      low: 0.5,
      high: 1,
    });
    expect([r.low.value, r.high.value]).toEqual([expect.closeTo(407, 9), expect.closeTo(814, 9)]);
  });

  it("price change and retain at risk", () => {
    // 37,000 × −5% … +5% = −1,850 … 1,850
    const p = impactRange({ type: "price_change", revenue: { ref: ref("rev"), value: 37000 }, low: -0.05, high: 0.05 });
    expect([p.low.value, p.high.value]).toEqual([expect.closeTo(-1850, 9), expect.closeTo(1850, 9)]);
    // 8,500 × 0.3 … 0.9 = 2,550 … 7,650
    const k = impactRange({ type: "retain_at_risk", atRisk: { ref: ref("risk"), value: 8500 }, low: 0.3, high: 0.9 });
    expect([k.low.value, k.high.value]).toEqual([expect.closeTo(2550, 9), expect.closeTo(7650, 9)]);
  });

  it("rejects parameters outside the allowed set", () => {
    expect(() => impactRange({ type: "recover_share", lost: { ref: ref("l"), value: 100 }, low: 0.1, high: 0.9 })).toThrow(ImpactError);
    expect(() => impactRange({ type: "price_change", revenue: { ref: ref("r"), value: 100 }, low: -0.2, high: 0 })).toThrow(
      /outside the allowed range/,
    );
    expect(() => impactRange({ type: "retain_at_risk", atRisk: { ref: ref("r"), value: 100 }, low: 0.8, high: 0.4 })).toThrow(/above high/);
    expect(() => impactRange({ type: "recover_share", lost: { ref: ref("l"), value: 100 }, low: 0.3, high: 0.9, discount: 0.9 })).toThrow(
      /discount/,
    );
  });
});

describe("scenario parameters can cite their justification", () => {
  it("justifiedBy refs become the inputs of every scenario_param fact", () => {
    const quote = { kind: "point", series: "supplier_discount", period: "2026-04" } as const;
    const r = impactRange({
      type: "recover_share",
      lost: { ref: { kind: "point", series: "revenue", period: "2026-04" }, value: -8500 },
      low: 0.3,
      high: 0.6,
      discount: 0.1,
      justifiedBy: [quote],
    });
    expect(r.params.map((p) => p.inputs)).toEqual([[quote], [quote], [quote]]);
    // 8,500 × 0.3 × 0.9 = 2,295 · 8,500 × 0.6 × 0.9 = 4,590
    expect(r.low.value).toBeCloseTo(2295, 9);
    expect(r.high.value).toBeCloseTo(4590, 9);
  });
});

describe("ranking (spec §6)", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
  const s = (id: string, values: number[], unit: Series["unit"]): Series => ({
    id,
    metric: id,
    unit,
    points: values.map((value, i) => ({ period: months[i] ?? "", value })),
  });
  const revenue = s("revenue", [41200, 42900, 44100, 36200, 35800, 37000], "currency");
  const refund = s("refund_rate", [1.1, 1.0, 1.2, 1.3, 2.9, 3.4], "percent");

  it("scores by impact share × confidence × recency", () => {
    const revBreak = trendBreak(revenue) as Insight;
    const refBreak = trendBreak(refund) as Insight;
    const totals = new Map(revenue.points.map((p) => [p.period, p.value]));
    const ranked = rankInsights([revBreak, refBreak, periodChange(revenue) as Insight], {
      objectiveMetric: "revenue",
      objectiveTotals: totals,
      periods: months,
      changeOf: insightChange,
    });
    // A break on exactly 6 points (3 per side, the minimum) has medium confidence (weight 0.6).
    // Breaks rank by the shift that persists to the latest period (change_since), as in the runner.
    // revenue break at Apr: |37,000 − 44,100| = 7,100 / 36,200 = 0.196133 × 0.6 × 0.8² (2 periods back) = 0.075315
    // refund break at Apr: 2.2 pp → 0.022 × 0.6 × 0.8² = 0.00845; June's revenue change is not material → excluded
    expect(ranked.map((r) => [r.insight.metric, Number(r.score.toFixed(5))])).toEqual([
      ["revenue", 0.07531],
      ["refund_rate", 0.00845],
    ]);
  });

  it("EXPLAIN gets one finding per event: the highest-priority template, scored by the best score in the group", () => {
    const mk = (template: string, series: string, period: string, score: number) => ({
      insight: { template, series, period } as unknown as Insight,
      impactShare: score,
      score,
    });
    const top = topForExplain([
      mk("new_lost.v1", "revenue", "2026-04", 0.15),
      mk("anomaly.v1", "revenue", "2026-04", 0.14),
      mk("trend_break.v1", "revenue", "2026-04", 0.08),
      mk("trend_break.v1", "refund_rate", "2026-04", 0.01),
    ]);
    expect(top.map((r) => [r.insight.template, r.insight.series, r.score])).toEqual([
      ["trend_break.v1", "revenue", 0.15],
      ["trend_break.v1", "refund_rate", 0.01],
    ]);
  });

  it("gives each metric family one slot before any family gets a second (a channel slice is in its parent's family)", () => {
    const mk = (metric: string, period: string, score: number, member?: string) => ({
      insight: {
        template: "period_change.v1",
        metric,
        series: member ? `${metric}|customer=${member}` : metric,
        period,
        ...(member ? { member: { dimension: "customer", value: member } } : {}),
      } as unknown as Insight,
      impactShare: score,
      score,
    });
    // Three restatements of one revenue drop outscore the refund rate tripling (0.012); with max = 3 the rate still
    // gets a slot, then the strongest single-member change (Key Co), ahead of the wholesale slice and the
    // year-on-year restatement.
    const top = topForExplain(
      [
        mk("revenue", "2026-06", 0.27),
        mk("wholesale_revenue", "2026-04", 0.25),
        mk("revenue", "2026-04", 0.2),
        mk("revenue", "2026-04", 0.19, "Key Co"),
        mk("refund_rate", "2026-05", 0.012),
      ],
      3,
    );
    expect(top.map((r) => [r.insight.series, r.insight.period])).toEqual([
      ["revenue", "2026-06"],
      ["refund_rate", "2026-05"],
      ["revenue|customer=Key Co", "2026-04"],
    ]);
  });

  it("metricFamily: a slice id is <prefix>_<parent>", () => {
    const ms = ["revenue", "wholesale_revenue", "refund_rate", "orders"];
    expect(metricFamily("wholesale_revenue", ms)).toBe("revenue");
    expect(metricFamily("refund_rate", ms)).toBe("refund_rate");
    expect(metricFamily("revenue", ms)).toBe("revenue");
    expect(metricFamily("orders", ms)).toBe("orders");
  });
});
