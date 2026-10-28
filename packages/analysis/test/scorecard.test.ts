// The scorecard (analysis-library §12). Part 1 is the spec's hand-computed table on coffee-roaster-v1, from the dataset's
// monthly ground truth (evals/datasets/coffee-roaster-v1/answers.yaml, January to June 2026), through the real pipeline.
// Part 2 is `planRow` on hand-built series: the trailing-mean baseline, the year-on-year column and the grains.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingest } from "@agentic-analytics/ingest";
import { fallbackMetrics, loadCatalog, validateMetrics } from "@agentic-analytics/metrics";
import { profileJob } from "@agentic-analytics/profile";
import type { Fact, MetricDef, ScorecardRow } from "@agentic-analytics/schema";
import { Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AnalysisResult,
  analyzeJob,
  planRow,
  planScorecard,
  SCORECARD_ROWS,
  type Series,
  scorecardMetrics,
  yoyGap,
} from "../src/index.ts";

const dir = join(import.meta.dirname, "..", "..", "..", "evals/datasets/coffee-roaster-v1/files");
let ws: Workspace;
let result: AnalysisResult;

beforeAll(async () => {
  ws = await Workspace.open();
  const files = ["sales-2026.xlsx"].map((f) => ({ name: f, bytes: new Uint8Array(readFileSync(join(dir, f))) }));
  const summary = await profileJob(ws, await ingest(files), { today: "2026-07-01" });
  const catalog = await loadCatalog(ws);
  const defs = validateMetrics(fallbackMetrics(summary), catalog, { defaultCurrency: "USD" }).accepted;
  result = await analyzeJob(ws, defs, catalog, { from: "2026-01", to: "2026-06" });
}, 120_000);
afterAll(() => ws.close());

const fact = (id: string | undefined): Fact => {
  const f = result.facts.find((x) => x.id === id);
  if (!f) throw new Error(`no fact ${id}`);
  return f;
};
const row = (metric: string): ScorecardRow => {
  const r = result.scorecard?.rows.find((x) => x.metric_id === metric);
  if (!r) throw new Error(`no scorecard row for ${metric}`);
  return r;
};
const base = (r: ScorecardRow) => {
  if ("na" in r.vs_base) throw new Error(`${r.metric_id} has no baseline`);
  return r.vs_base;
};

describe("the scorecard on coffee-roaster-v1 (analysis-library §12, hand-computed)", () => {
  it("is for the last complete period, June 2026", () => {
    expect(result.scorecard?.period).toBe("2026-06");
  });

  it("revenue: 37,000, +1,200 (+3.352%) vs May, band 3,113.46, not material", () => {
    const r = row("revenue");
    expect(fact(r.value).value).toBeCloseTo(37000, 6);
    expect(base(r)).toMatchObject({ method: "previous_period", periods: ["2026-05"] });
    // 37,000 − 35,800 = 1,200; 37,000 ÷ 35,800 − 1 = 3.3520%.
    expect(fact(base(r).change).value).toBeCloseTo(1200, 6);
    expect(fact(base(r).change_pct).value).toBeCloseTo(3.351955, 5);
    // Changes +1,700, +1,200, −7,900, −400 (the last, +1,200, is left out): median (−400 + 1,200) ÷ 2 = 400; absolute
    // deviations 1,300, 800, 8,300, 800 with median (800 + 1,300) ÷ 2 = 1,050; band 2 × 1.4826 × 1,050 = 3,113.46.
    expect(fact(r.materiality_inputs?.band).value).toBeCloseTo(3113.46, 6);
    // Mean of 41,200, 42,900, 44,100, 36,200, 35,800, 37,000 = 237,200 ÷ 6 = 39,533.33.
    expect(fact(r.materiality_inputs?.mean).value).toBeCloseTo(39533.333333, 4);
    // |1,200| ≤ 3,113.46 and 3.35% < 5%: not material.
    expect(r.material).toBe(false);
    expect(r.yoy).toEqual({ na: "too_few_periods" });
  });

  it("orders: 1,040, +35 (+3.483%), band 81.543, not material", () => {
    const r = row("orders");
    expect(fact(r.value).value).toBe(1040);
    expect(fact(base(r).change).value).toBe(35); // 1,040 − 1,005
    expect(fact(base(r).change_pct).value).toBeCloseTo(3.482587, 5); // 1,040 ÷ 1,005 − 1
    // Changes +30, +40, −30, −15 (+35 left out): median 7.5, deviations 22.5, 32.5, 37.5, 22.5 → 27.5; 2 × 1.4826 × 27.5.
    expect(fact(r.materiality_inputs?.band).value).toBeCloseTo(81.543, 9);
    expect(r.material).toBe(false);
  });

  it("refund rate: 3.4%, +0.5 pp (+17.24%), band 0.44478, material", () => {
    const r = row("refund_rate");
    expect(fact(r.value).value).toBeCloseTo(3.4, 9);
    expect(fact(base(r).change).value).toBeCloseTo(0.5, 9); // 3.4 − 2.9
    expect(fact(base(r).change_pct).value).toBeCloseTo(17.241379, 5); // 3.4 ÷ 2.9 − 1
    // Changes −0.1, +0.2, +0.1, +1.6 (+0.5 left out): median 0.15, deviations 0.25, 0.05, 0.05, 1.45 → 0.15; 2 × 1.4826 × 0.15.
    expect(fact(r.materiality_inputs?.band).value).toBeCloseTo(0.44478, 9);
    // Mean (1.1 + 1.0 + 1.2 + 1.3 + 2.9 + 3.4) ÷ 6 = 1.8167. |0.5| > 0.44478, 17.24% ≥ 5% and 0.5 ≥ 1% of 1.8167: material.
    expect(fact(r.materiality_inputs?.mean).value).toBeCloseTo(1.816667, 5);
    expect(r.material).toBe(true);
  });

  it("every cell is a fact with a fixed label that names the metric and the period (§14)", () => {
    for (const r of result.scorecard?.rows ?? []) {
      const b = base(r);
      expect(fact(b.change).label).toBe(`scorecard.${r.metric_id}.vs_base_2026-06`);
      expect(fact(b.change).computation).toMatchObject({ kind: "function", fn: "delta", inputs: [r.value, expect.any(String)] });
      if (b.change_pct) expect(fact(b.change_pct).label).toBe(`scorecard.${r.metric_id}.vs_base_pct_2026-06`);
      expect(fact(r.materiality_inputs?.mean).label).toBe(`scorecard.${r.metric_id}.mean_2026-06`);
      if (r.materiality_inputs?.band) expect(fact(r.materiality_inputs.band).computation.fn).toBe("noise_band");
    }
    const labels = result.facts.map((f) => f.label).filter((l) => l.startsWith("scorecard."));
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("has no year-on-year in six months: not enough periods (§12)", () => {
    expect(result.scorecard?.rows.every((r) => "na" in r.yoy && r.yoy.na === "too_few_periods")).toBe(true);
  });
});

describe("rows and their order (§12)", () => {
  const def = (id: string, type: MetricDef["type"]): MetricDef => ({ id, label: id, type, unit: "count", status: "assumed" });
  it("puts the pack KPIs first in §8.1's order, then margin, then the other sums, counts and ratios", () => {
    const defs = [
      def("other_sum", "sum"),
      def("refund_rate", "ratio"),
      def("gross_margin", "derived"),
      def("revenue", "sum"),
      def("helper_distinct", "count_distinct"),
      def("costed_revenue", "sum"),
      ...Array.from({ length: 12 }, (_, i) => def(`extra_${i}`, "count")),
    ];
    const ids = scorecardMetrics(defs).map((d) => d.id);
    expect(ids.slice(0, 4)).toEqual(["revenue", "refund_rate", "gross_margin", "other_sum"]);
    // Every eligible metric, uncapped: the cap applies to the planned rows.
    expect(ids).toHaveLength(16);
    expect(ids).not.toContain("helper_distinct");
    expect(ids).not.toContain("costed_revenue");
  });
});

describe("planScorecard (§12)", () => {
  const def = (id: string): MetricDef => ({ id, label: id, type: "count", unit: "count", status: "assumed" });
  const months = ["2026-01", "2026-02", "2026-03"];
  const totals = (ids: readonly string[], last: number) =>
    new Map(
      ids.map((id): [string, Series] => [
        id,
        { id, metric: id, unit: "count", points: months.map((period, i) => ({ period, value: i === 2 ? last : 1 })) },
      ]),
    );

  it("caps at 12 after leaving out the metrics with no value in the period, so an eligible metric takes the place", () => {
    // 14 metrics; the first two have no value in March: the 12 rows are the other 12, not 10.
    const ids = Array.from({ length: 14 }, (_, i) => `m${i}`);
    const t = totals(ids, 5);
    for (const id of ["m0", "m1"]) {
      const s = t.get(id) as Series;
      t.set(id, { ...s, points: s.points.map((p) => (p.period === "2026-03" ? { ...p, value: Number.NaN } : p)) });
    }
    const plan = planScorecard(ids.map(def), t, months, "month");
    expect(plan?.rows.map((r) => r.metric)).toEqual(ids.slice(2));
    expect(plan?.rows).toHaveLength(SCORECARD_ROWS);
  });
});

describe("planRow (§12)", () => {
  const series = (values: readonly number[], first = 2025, unit: Series["unit"] = "currency"): Series => ({
    id: "m",
    metric: "m",
    unit,
    points: values.map((value, i) => ({ period: `${first + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, value })),
  });
  const calc = (p: ReturnType<typeof planRow>, name: string) => p?.calcs.find((c) => c.name === name);

  it("uses the trailing mean of 3 when the previous period has no value", () => {
    // A ratio unknown in May: June 12 against the mean of February, March and April, (8 + 9 + 10) ÷ 3 = 9.
    const p = planRow(series([7, 8, 9, 10, Number.NaN, 12], 2026, "percent"), "2026-06", "month", 6);
    expect(p?.vsBase).toEqual({ method: "trailing_mean_3", periods: ["2026-02", "2026-03", "2026-04"] });
    expect(calc(p, "base")).toMatchObject({ value: 9, fn: "trailing_mean_3" });
    expect(calc(p, "vs_base")).toMatchObject({ value: 3, fn: "delta", factLabel: "scorecard.m.vs_base_2026-06" });
    expect(calc(p, "vs_base_pct")?.value).toBeCloseTo((12 / 9 - 1) * 100, 12);
    // Five known points: no noise band, so the flag is null (§12).
    expect(calc(p, "band")).toBeUndefined();
    expect(p?.material).toBeNull();
  });

  it("states the change against the same month a year earlier with 13 months", () => {
    // Jan 2025 … Jan 2026, 100 then +10 a month: Jan 2026 is 220 against 100 a year earlier, +120 = +120%.
    const p = planRow(series(Array.from({ length: 13 }, (_, i) => 100 + 10 * i)), "2026-01", "month", 13);
    expect(p?.yoy).toEqual({ period: "2025-01" });
    expect(calc(p, "yoy")).toMatchObject({ value: 120, factLabel: "scorecard.m.yoy_2026-01" });
    expect(calc(p, "yoy_pct")?.value).toBeCloseTo(120, 12);
    // The changes are all +10, so the median absolute deviation and the band are 0: |+10| > 0, +4.8% < 5%: not material.
    expect(calc(p, "band")?.value).toBe(0);
    expect(p?.material).toBe(false);
  });

  it("reads the band and the mean over the last 36 points at most, so a long or daily series doesn't cite every period", () => {
    // Jan 2025 … Dec 2028, 100 then +10 a month: the last 36 are Jan 2026 (220) … Dec 2028 (570), mean (220 + 570) ÷ 2 = 395
    // (the whole series' mean would be 335). Every change is +10, so the band is 0.
    const p = planRow(series(Array.from({ length: 48 }, (_, i) => 100 + 10 * i)), "2028-12", "month", 48);
    expect(calc(p, "mean")?.value).toBeCloseTo(395, 9);
    expect(calc(p, "mean")?.inputs).toHaveLength(36);
    expect(calc(p, "mean")?.inputs[0]).toEqual({ kind: "point", series: "m", period: "2026-01" });
    expect(calc(p, "band")?.inputs).toHaveLength(36);
    expect(calc(p, "band")?.value).toBe(0);
  });

  it("states no change % against a base that is not positive", () => {
    const p = planRow(series([-5, -4, 0, 3]), "2025-04", "month", 4);
    expect(calc(p, "vs_base")?.value).toBe(3);
    expect(calc(p, "vs_base_pct")).toBeUndefined();
  });

  it("knows which grains compare a year (13 months, 5 quarters, 2 years; never weeks or days)", () => {
    expect(yoyGap("month", 12)).toBe("too_few_periods");
    expect(yoyGap("month", 13)).toBeUndefined();
    expect(yoyGap("quarter", 4)).toBe("too_few_periods");
    expect(yoyGap("quarter", 5)).toBeUndefined();
    expect(yoyGap("year", 2)).toBeUndefined();
    expect(yoyGap("week", 200)).toBe("grain_not_comparable");
    expect(yoyGap("day", 900)).toBe("grain_not_comparable");
  });

  it("has no row for a period without a value", () => {
    expect(planRow(series([1, 2, Number.NaN], 2026, "percent"), "2026-03", "month", 3)).toBeUndefined();
    expect(planRow(series([1, 2]), "2026-09", "month", 2)).toBeUndefined();
  });
});
