import { describe, expect, it } from "vitest";
import {
  anomalies,
  benchmarkGap,
  concentration,
  type Insight,
  mixShift,
  newLost,
  periodChange,
  ratioShift,
  trend,
  trendBreak,
} from "../src/templates.ts";
import type { Calc, Series } from "../src/types.ts";

const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
const series = (id: string, values: number[], unit: Series["unit"] = "currency", member?: Series["member"]): Series => ({
  id,
  metric: id.split("|")[0] ?? id,
  unit,
  ...(member ? { member } : {}),
  points: values.map((value, i) => ({ period: months[i] ?? `p${i}`, value })),
});
// coffee-roaster-v1 answer key
const REVENUE = series("revenue", [41200, 42900, 44100, 36200, 35800, 37000]);
const REFUND_RATE = series("refund_rate", [1.1, 1.0, 1.2, 1.3, 2.9, 3.4], "percent");
const WHOLESALE = series("revenue|channel=wholesale", [14800, 15300, 15900, 7400, 7100, 7300], "currency", {
  dimension: "channel",
  value: "wholesale",
});
const RETAIL = series("revenue|channel=retail", [26400, 27600, 28200, 28800, 28700, 29700], "currency", {
  dimension: "channel",
  value: "retail",
});
const calc = (i: Insight, name: string) => i.calcs.find((c: Calc) => c.name === name)?.value;
const isInsight = (x: unknown): x is Insight => typeof x === "object" && x !== null && "template" in x;

describe("period_change.v1", () => {
  it("June vs May revenue: +1,200 (+3.35%) is not material", () => {
    const i = periodChange(REVENUE);
    expect(calc(i as Insight, "change")).toBe(1200); // 37,000 − 35,800
    expect(calc(i as Insight, "change_pct")).toBeCloseTo(3.351955, 5); // 37,000 / 35,800 − 1
    // band without June's change: [1700, 1200, −7900, −400] → median 400, MAD 1050 → 2 × 1.4826 × 1050 = 3113.46
    expect(i?.details.noise_band).toBeCloseTo(3113.46, 2);
    expect(i?.material).toBe(false);
    expect(i?.roles.before).toEqual({ kind: "point", series: "revenue", period: "2026-05" });
  });
});

describe("trend_break.v1 — coffee-roaster golden numbers", () => {
  it("revenue breaks after March: Apr vs Mar −17.9%", () => {
    const i = trendBreak(REVENUE);
    if (!isInsight(i)) throw new Error("skipped");
    expect(i.details.split_after).toBe("2026-03");
    // means: 128,200 / 3 = 42,733.33 and 109,000 / 3 = 36,333.33 → shift −6,400
    expect(calc(i, "shift")).toBeCloseTo(-6400, 6);
    // 36,200 / 44,100 − 1 = −0.179138 → −17.9%
    expect(calc(i, "change")).toBe(-7900);
    expect(calc(i, "change_pct")).toBeCloseTo(-17.913832, 5);
    // band without April's change = 741.3 < 6,400 and shift = −15.0% of the earlier mean → material
    expect(i.details.noise_band).toBeCloseTo(741.3, 6);
    expect(i.material).toBe(true);
    expect(i.period).toBe("2026-04");
  });

  it("refund rate: 1.2% before the break → 3.4% latest", () => {
    const i = trendBreak(REFUND_RATE);
    if (!isInsight(i)) throw new Error("skipped");
    expect(i.roles.before).toEqual({ kind: "point", series: "refund_rate", period: "2026-03" }); // 1.2
    expect(i.roles.latest).toEqual({ kind: "point", series: "refund_rate", period: "2026-06" }); // 3.4
    expect(calc(i, "change_since")).toBeCloseTo(2.2, 12); // 3.4 − 1.2
    expect(calc(i, "change_since_pct")).toBeCloseTo(183.3333, 3); // 3.4 / 1.2 − 1
    // means 3.3 / 3 = 1.1 and 7.6 / 3 = 2.5333 → shift 1.4333; band: changes without Apr's
    // [−0.1, 0.2, 1.6, 0.5] → median 0.35, MAD 0.3 → 2 × 1.4826 × 0.3 = 0.8896 < 1.4333 → material
    expect(calc(i, "shift")).toBeCloseTo(1.433333, 5);
    expect(i.details.noise_band).toBeCloseTo(0.88956, 4);
    expect(i.material).toBe(true);
  });

  it("needs three points on each side", () => {
    expect(trendBreak(series("x", [1, 2, 3, 4, 5]))).toEqual({ skipped: "Trend-break test needs 3+ periods on each side; x has 5." });
  });
});

describe("trend.v1", () => {
  it("a steadily rising series is a significant trend", () => {
    // [1..6]: S = 15; Var = 6·5·17 / 18 = 28.333; Z = 14 / 5.3229 = 2.630; p = 0.00853 < 0.01
    const i = trend(series("x", [1, 2, 3, 4, 5, 6], "count"));
    if (!isInsight(i)) throw new Error("skipped");
    expect(calc(i, "slope")).toBe(1);
    expect(calc(i, "p_value")).toBeCloseTo(0.00853, 4);
    expect([i.material, i.confidence]).toEqual([true, "high"]);
  });

  it("coffee revenue has no significant trend", () => {
    // S = −1 − 2 − 3 + 0 + 1 = −5; Z = (−5 + 1) / 5.3229 = −0.7515; p = 0.452
    const i = trend(REVENUE);
    if (!isInsight(i)) throw new Error("skipped");
    expect(i.details.mann_kendall_s).toBe(-5);
    expect(calc(i, "p_value")).toBeCloseTo(0.4523, 3);
    expect(i.material).toBe(false);
  });

  it("needs four periods", () => {
    expect(trend(series("x", [1, 2, 3]))).toEqual({ skipped: "Trend test needs 4+ periods of x; only 3 available." });
  });
});

describe("anomaly.v1", () => {
  it("April's −7,900 is an anomaly; May's −400 has a large z but is too small to matter", () => {
    const found = anomalies(REVENUE);
    if (!Array.isArray(found)) throw new Error("skipped");
    // April: other changes [1700, 1200, −400, 1200] → median 1200, MAD 250 → z = (−7900 − 1200) / 370.65 = −24.55
    expect(found.map((i) => [i.period, Number((calc(i, "robust_z") ?? 0).toFixed(2))])).toEqual([["2026-04", -24.55]]);
    // May: z = (−400 − 1200) / 370.65 = −4.32 (> 3.5) but −400 / 36,200 = −1.1% < 5% → not reported
  });
});

describe("concentration, new/lost and mix shift", () => {
  it("June revenue is concentrated in retail", () => {
    const i = concentration("revenue", REVENUE, [WHOLESALE, RETAIL], "2026-06", "channel");
    // 29,700 / 37,000 = 80.27%; shares 0.197297 and 0.802703 → HHI = 0.038926 + 0.644332 = 0.683258
    expect(calc(i as Insight, "top_share")).toBeCloseTo(80.27027, 4);
    expect(calc(i as Insight, "hhi")).toBeCloseTo(0.683258, 5);
    expect(i?.material).toBe(true);
  });

  it("a customer present in March and absent in April is lost, with its March value at risk", () => {
    const hotel = series("revenue|customer=Hotel Group LLC", [0, 0, 8500, 0, 0, 0], "currency", {
      dimension: "customer",
      value: "Hotel Group LLC",
    });
    const cafe = series("revenue|customer=Cafe", [1, 1, 2300, 2400, 2300, 2400], "currency", { dimension: "customer", value: "Cafe" });
    const i = newLost("revenue", REVENUE, [hotel, cafe], "2026-03", "2026-04", "customer");
    expect(calc(i as Insight, "lost_value")).toBe(8500);
    expect(i?.details.lost).toEqual(["Hotel Group LLC"]);
  });

  it("wholesale's share fell 15.6 pp from March to April", () => {
    // 15,900 / 44,100 = 36.0544% → 7,400 / 36,200 = 20.4420% → −15.6124 pp
    const i = mixShift("revenue", REVENUE, [WHOLESALE, RETAIL], "2026-03", "2026-04", "channel");
    expect(calc(i as Insight, "share_shift_pp")).toBeCloseTo(-15.6124, 3);
    expect(i?.details.member).toBe("wholesale");
    expect(i?.material).toBe(true);
  });
});

describe("ratio_shift.v1 and benchmark_gap.v1", () => {
  it("uses a two-proportion test when counts are known", () => {
    const i = ratioShift(REFUND_RATE, { before: { num: 12, den: 1000 }, after: { num: 34, den: 1000 } });
    // z = 3.2817 → p = 0.00103 (see stats tests)
    expect(calc(i as Insight, "p_value")).toBeCloseTo(0.00103, 4);
    expect([i?.material, i?.confidence, i?.details.test]).toEqual([true, "high", "two_proportion_z"]);
  });

  it("measures the gap to an external range and labels it external", () => {
    const own = series("price_rise", [12], "percent");
    const i = benchmarkGap(
      { series: own, period: "2026-01" },
      { low: { kind: "calc", name: "low" }, high: { kind: "calc", name: "high" }, lowValue: 5, highValue: 8 },
    );
    expect(calc(i as Insight, "gap")).toBe(4); // 12 − 8
    expect(i?.details.external).toBe(true);
  });
});
