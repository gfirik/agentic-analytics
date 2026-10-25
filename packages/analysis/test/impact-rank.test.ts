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
        // A rate's change is in percentage points: that is what makes it a rate for the lead order.
        roles: { change: "N1" },
        calcs: [{ name: "change", value: 1, unit: metric.endsWith("_rate") ? "percent" : "currency" }],
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

  it("the lead order: the strongest change, the strongest rate, the member story, then the other families (M14a)", () => {
    // coffee_roaster-v3 and clinic-v2 in the 2026-10-19 nightly run, reduced: gross margin, a second sales measure and
    // two count metrics each restate the revenue drop or score 0, yet as family firsts they took slots 2 and 3, so the
    // refund rate (P2) and the product that collapsed (P3) were never explained in small-model mode (3 findings).
    const mk = (o: { metric: string; score: number; unit: string; member?: string; pct?: number; period?: string }) => ({
      insight: {
        template: "period_change.v1",
        metric: o.metric,
        series: o.member ? `${o.metric}|product=${o.member}` : o.metric,
        period: o.period ?? "2026-06",
        roles: { change: "N1" },
        calcs: [
          { name: "change", value: -1, unit: o.unit },
          ...(o.pct === undefined ? [] : [{ name: "change_pct", value: o.pct, unit: "percent" }]),
        ],
        ...(o.member ? { member: { dimension: "product", value: o.member } } : {}),
      } as unknown as Insight,
      impactShare: o.score,
      score: o.score,
    });
    const rows = [
      mk({ metric: "revenue", score: 0.12, unit: "currency" }),
      mk({ metric: "gross_margin", score: 0.11, unit: "currency" }),
      mk({ metric: "total_sales_amount", score: 0.1, unit: "currency" }),
      mk({ metric: "customer_count", score: 0, unit: "count" }),
      mk({ metric: "orders_count", score: 0, unit: "count" }),
      mk({ metric: "refund_rate", score: 0.025, unit: "percent", period: "2026-03" }),
      mk({ metric: "revenue", score: 0.05, unit: "currency", member: "Old", pct: -70, period: "2026-01" }),
    ];
    expect(topForExplain(rows, 3).map((r) => r.insight.series)).toEqual(["revenue", "refund_rate", "revenue|product=Old"]);
    // Without a rate the member story is second; the other families follow it.
    expect(
      topForExplain(
        rows.filter((r) => r.insight.metric !== "refund_rate"),
        3,
      ).map((r) => r.insight.series),
    ).toEqual(["revenue", "revenue|product=Old", "gross_margin"]);
    // printing_shop-v3, reduced: the product's change on a channel slice (a larger relative change) speaks through the
    // objective's change for the same product and period, whose id the slice doesn't share.
    const sliced = [
      mk({ metric: "total_revenue", score: 0.12, unit: "currency" }),
      mk({ metric: "revenue_by_channel_walkin", score: 0.05, unit: "currency", member: "Old", pct: -80, period: "2026-01" }),
      mk({ metric: "total_revenue", score: 0.05, unit: "currency", member: "Old", pct: -70, period: "2026-01" }),
    ];
    expect(topForExplain(sliced, 2, { objective: "total_revenue" }).map((r) => r.insight.series)).toEqual([
      "total_revenue",
      "total_revenue|product=Old",
    ]);
    // The objective leads when it carries at least half the best family's score: gross margin restates the same drop
    // a little higher. Below half, the best family leads.
    const margin = [
      mk({ metric: "gross_margin", score: 0.12, unit: "currency" }),
      mk({ metric: "revenue", score: 0.07, unit: "currency" }),
    ];
    expect(topForExplain(margin, 1, { objective: "revenue" })[0]?.insight.metric).toBe("revenue");
    expect(topForExplain(margin, 1)[0]?.insight.metric).toBe("gross_margin");
    expect(
      topForExplain(
        [mk({ metric: "gross_margin", score: 0.12, unit: "currency" }), mk({ metric: "revenue", score: 0.05, unit: "currency" })],
        1,
        { objective: "revenue" },
      )[0]?.insight.metric,
    ).toBe("gross_margin");
    // Another event comes before a restatement of the lead's period: a rate break three months earlier takes the rate
    // slot from a larger rate move in the lead's own period, and the same holds for members. A family with no measured
    // change (score 0) comes after every material change, whatever its period (M15 PR 7: also after the restating member).
    const periods = [
      mk({ metric: "revenue", score: 0.12, unit: "currency" }),
      mk({ metric: "margin_rate", score: 0.04, unit: "percent", pct: -40 }),
      mk({ metric: "refund_rate", score: 0.02, unit: "percent", pct: 150, period: "2026-03" }),
      mk({ metric: "revenue", score: 0.05, unit: "currency", member: "Same", pct: -90 }),
      mk({ metric: "revenue", score: 0.03, unit: "currency", member: "Old", pct: -60, period: "2026-01" }),
      mk({ metric: "orders_count", score: 0, unit: "count", period: "2026-02" }),
      mk({ metric: "net_profit", score: 0.08, unit: "currency" }),
    ];
    expect(topForExplain(periods, 6, { objective: "revenue" }).map((r) => r.insight.series)).toEqual([
      "revenue",
      "refund_rate",
      "revenue|product=Old",
      "net_profit",
      "margin_rate",
      "revenue|product=Same",
    ]);
    expect(topForExplain(periods, 7, { objective: "revenue" }).map((r) => r.insight.series)).toContain("orders_count");
    // Without the objective named, the slice speaks (its id isn't `<prefix>_total_revenue`).
    expect(topForExplain(sliced, 2).map((r) => r.insight.series)).toEqual(["total_revenue", "revenue_by_channel_walkin|product=Old"]);
  });

  it("a pack-sized metric set keeps the planted events in the top 5: families by definition, not by id suffix (M15 PR 7)", () => {
    // The KPI pack adds orders, units, customers, new and returning customers, aov and the order helpers to revenue and a
    // refund rate. Counts and the aov score 0 here (spec §6: only money and percent changes carry an impact), the
    // pack's slices (`refunded_orders` of `all_orders`) are named by what they count, and a channel slice whose id has no
    // `_revenue` suffix (`walkin_sales`) is still revenue's slice. P1 is the revenue drop, P2 the refund rate, P3 the
    // member story.
    const mk = (metric: string, period: string, score: number, unit: string, member?: string) => ({
      insight: {
        template: "period_change.v1",
        metric,
        series: member ? `${metric}|customer=${member}` : metric,
        period,
        roles: { change: "N1" },
        calcs: [{ name: "change", value: 1, unit }],
        ...(member ? { member: { dimension: "customer", value: member } } : {}),
      } as unknown as Insight,
      impactShare: score,
      score,
    });
    const ranked = [
      mk("revenue", "2026-06", 0.27, "currency"),
      mk("walkin_sales", "2026-06", 0.26, "currency"),
      mk("units", "2026-06", 0, "count"),
      mk("orders", "2026-06", 0, "count"),
      mk("customers", "2026-06", 0, "count"),
      mk("new_customers", "2026-06", 0, "count"),
      mk("returning_customers", "2026-06", 0, "count"),
      mk("refunded_orders", "2026-06", 0, "count"),
      mk("aov", "2026-06", 0, "ratio"),
      mk("refund_rate", "2026-05", 0.012, "percent"),
      mk("revenue", "2026-04", 0.19, "currency", "Key Co"),
      // P4: a smaller member change in another month (the planted Linen throw of online_store-v3, M15 PR 7)
      mk("revenue", "2026-02", 0.05, "currency", "Linen throw"),
    ];
    const slices = new Map([["walkin_sales", "revenue"]]);
    const top = topForExplain(ranked, 5, { objective: "revenue", slices }).map((r) => [r.insight.series, r.insight.period]);
    expect(top.slice(0, 3)).toEqual([
      ["revenue", "2026-06"],
      ["refund_rate", "2026-05"],
      ["revenue|customer=Key Co", "2026-04"],
    ]);
    // The count families (score 0) come after every material change, so they cannot push the smaller planted member out of the top 5.
    expect(topForExplain(ranked, 5, { objective: "revenue", slices }).map((r) => r.insight.series)).toContain(
      "revenue|customer=Linen throw",
    );
    // The slice is in revenue's family: it does not take a second family slot ahead of the count families.
    expect(top.slice(0, 3).map(([s]) => s)).not.toContain("walkin_sales");
  });

  it("metricFamily: a slice id is <prefix>_<parent>", () => {
    const ms = ["revenue", "wholesale_revenue", "refund_rate", "orders"];
    expect(metricFamily("wholesale_revenue", ms)).toBe("revenue");
    expect(metricFamily("refund_rate", ms)).toBe("refund_rate");
    expect(metricFamily("revenue", ms)).toBe("revenue");
    expect(metricFamily("orders", ms)).toBe("orders");
  });
});

describe("topForExplain rules, hand-computed (spec §6, M13a)", () => {
  const mk = (o: {
    template?: string;
    metric?: string;
    period?: string;
    score: number;
    share?: number;
    member?: string;
    pct?: number;
    /** No measured change (a trend: slope and p-value only). */
    unmeasured?: boolean;
  }) => {
    const metric = o.metric ?? "revenue";
    const change = o.unmeasured ? [] : [{ name: "change", value: 1, unit: "currency" }];
    return {
      insight: {
        template: o.template ?? "period_change.v1",
        metric,
        series: o.member ? `${metric}|customer=${o.member}` : metric,
        period: o.period ?? "2026-04",
        roles: o.unmeasured ? {} : { change: "N1" },
        calcs: [...change, ...(o.pct === undefined ? [] : [{ name: "change_pct", value: o.pct, unit: "percent" }])],
        ...(o.member ? { member: { dimension: "customer", value: o.member } } : {}),
      } as unknown as Insight,
      impactShare: o.share ?? o.score,
      score: o.score,
    };
  };

  it("a group's representative is the highest-priority template carrying ≥ 50% of the group's best score", () => {
    // Best 0.20 → the bar is 0.10. trend_break at 0.09 is below it, so anomaly (next in priority) speaks for the group.
    const weak = topForExplain([mk({ template: "anomaly.v1", score: 0.2 }), mk({ template: "trend_break.v1", score: 0.09 })]);
    expect(weak.map((r) => [r.insight.template, r.score])).toEqual([["anomaly.v1", 0.2]]);
    // At 0.11 ≥ 0.10 it qualifies and outranks anomaly; the group keeps the best score, 0.20.
    const strong = topForExplain([mk({ template: "anomaly.v1", score: 0.2 }), mk({ template: "trend_break.v1", score: 0.11 })]);
    expect(strong.map((r) => [r.insight.template, r.score])).toEqual([["trend_break.v1", 0.2]]);
  });

  it("a template with no measured change keeps its priority although it scores 0 (Online Retail II's Nov peak)", () => {
    // trend.v1 has no Δ, so its impact share and score are 0; it isn't a weak change, so it still outranks new_lost
    // (0.119) and the group keeps new_lost's score.
    const top = topForExplain([mk({ template: "new_lost.v1", score: 0.119 }), mk({ template: "trend.v1", score: 0, unmeasured: true })]);
    expect(top.map((r) => [r.insight.template, r.score])).toEqual([["trend.v1", 0.119]]);
    // A measured template at 0 is weak: new_lost speaks.
    const weak = topForExplain([mk({ template: "new_lost.v1", score: 0.119 }), mk({ template: "trend.v1", score: 0 })]);
    expect(weak.map((r) => [r.insight.template, r.score])).toEqual([["new_lost.v1", 0.119]]);
  });

  it("the family slot goes to the parent metric when it carries ≥ 50% of the family's best", () => {
    // Family best: wholesale_revenue 0.30 → bar 0.15. revenue at 0.16 clears it and takes the slot.
    const a = topForExplain(
      [mk({ metric: "wholesale_revenue", score: 0.3 }), mk({ metric: "revenue", period: "2026-05", score: 0.16 })],
      1,
    );
    expect(a.map((r) => r.insight.metric)).toEqual(["revenue"]);
    // At 0.14 < 0.15 the slice keeps it.
    const b = topForExplain(
      [mk({ metric: "wholesale_revenue", score: 0.3 }), mk({ metric: "revenue", period: "2026-05", score: 0.14 })],
      1,
    );
    expect(b.map((r) => r.insight.metric)).toEqual(["wholesale_revenue"]);
  });

  it("on equal scores the earlier period (the onset) goes first", () => {
    const top = topForExplain([
      mk({ period: "2026-06", score: 0.2 }),
      mk({ period: "2026-04", score: 0.2 }),
      mk({ metric: "x", score: 0.01 }),
    ]);
    // One family slot each (revenue's best is the onset, 2026-04; then x), then the restatement.
    expect(top.map((r) => `${r.insight.metric}@${r.insight.period}`)).toEqual(["revenue@2026-04", "x@2026-04", "revenue@2026-06"]);
  });

  it("the member slot takes the largest |change_pct| at impact share ≥ 2%, skipping a member already named as driver", () => {
    const parent = mk({ period: "2026-06", score: 0.3 });
    const members = [
      mk({ member: "A", score: 0.05, pct: -90 }), // impact share 0.05 ≥ 0.02, |−90%|
      mk({ member: "B", period: "2026-05", score: 0.1, pct: -20 }), // 0.10 ≥ 0.02, |−20%|, higher score
      mk({ member: "C", period: "2026-03", score: 0.01, pct: -100 }), // 0.01 < 0.02: never a candidate
    ];
    // |−90| > |−20| → A, though B scores higher; C is excluded by the 2% floor.
    const top = topForExplain([parent, ...members], 2);
    expect(top.map((r) => r.insight.member?.value ?? r.insight.metric)).toEqual(["revenue", "A"]);
    // When the parent's decomposition already names customer=A as its driver, A restates it: B takes the slot.
    const drivers = new Map([[parent.insight, new Set(["customer=A"])]]);
    const told = topForExplain([parent, ...members], 2, { drivers });
    expect(told.map((r) => r.insight.member?.value ?? r.insight.metric)).toEqual(["revenue", "B"]);
  });
});
