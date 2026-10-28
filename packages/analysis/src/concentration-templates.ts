// concentration.v1 and dependence.v1 (analysis-library §3, §11.2–§11.4), over the dimension's exact member totals:
// positive keyed members, no 50-member cap, no "(other)" bucket. The numbers are `stat` references to the SQL facts of
// `concentration.sql.ts`; the values computed here decide materiality, and V2 recomputes the facts they point to.
import { MIN_PERIODS } from "./baselines.ts";
import { valueAt } from "./decomp-inputs.ts";
import { type Member, statValue } from "./pareto.ts";
import { mannKendall, theilSen } from "./stats.ts";
import type { Insight } from "./templates.ts";
import { type Calc, calcRef, point, type Series, type StatRef } from "./types.ts";

/** The top member's share at which dependence starts to matter, in percent (§3, §11.4). */
export const TOP_SHARE_AT = 30;
/** The HHI at which a dimension counts as concentrated (§3). */
export const HHI_AT = 0.25;
/** Periods the HHI and top-1 trend reads at most (the latest ones): a daily series would otherwise make 365 facts. */
export const TREND_PERIODS = 36;
export const TREND_P = 0.05;

/** A statistic of one metric and dimension over a single period. */
export const periodStat = (metric: string, dimension: string, part: StatRef["part"], period: string): StatRef => ({
  kind: "stat",
  metric,
  dimension,
  part,
  from: period,
  to: period,
  suffix: period,
});

/** Dependence on few members at `period` (§3): top-1 share ≥ 30% or HHI ≥ 0.25 over the exact member totals. */
export function concentration(
  metric: string,
  total: Series,
  dimension: string,
  period: string,
  members: readonly Member[],
  top?: Series,
): Insight | undefined {
  const share = statValue("top1_share", members);
  const index = statValue("hhi", members);
  const named = members
    .filter((m) => m.key !== null && m.total > 0)
    .sort((a, b) => b.total - a.total || ((a.key ?? "") < (b.key ?? "") ? -1 : 1));
  if (share === undefined || index === undefined || named.length < 2) return undefined;
  return {
    template: "concentration.v1",
    series: total.id,
    metric,
    period,
    direction: "flat",
    material: share >= TOP_SHARE_AT || index >= HHI_AT,
    confidence: "high",
    calcs: [],
    roles: {
      top_share: periodStat(metric, dimension, "top1_share", period),
      hhi: periodStat(metric, dimension, "hhi", period),
      ...(top ? { top_value: point(top.id, period) } : {}),
    },
    details: { dimension, top: named[0]?.key, members: named.length },
    notes: [],
  };
}

/** The HHI and top-1 share of each of the latest periods (those with a positive member), as computed in code. */
export interface ConcentrationTrend {
  readonly periods: readonly string[];
  readonly hhi: readonly number[];
  readonly top1: readonly number[];
}

export function concentrationTrend(perPeriod: ReadonlyMap<string, readonly Member[]>, periods: readonly string[]): ConcentrationTrend {
  const rows = periods.slice(-TREND_PERIODS).flatMap((p) => {
    const members = perPeriod.get(p) ?? [];
    const [h, t] = [statValue("hhi", members), statValue("top1_share", members)];
    return h === undefined || t === undefined ? [] : [{ p, h, t }];
  });
  return { periods: rows.map((r) => r.p), hhi: rows.map((r) => r.h), top1: rows.map((r) => r.t) };
}

const rising = (xs: readonly number[]) => xs.length >= MIN_PERIODS.trend && theilSen(xs) > 0 && mannKendall(xs).p < TREND_P;

/**
 * The trend facts of §11.3: Theil–Sen slope and Mann–Kendall p of the HHI and of the top-1 share over the periods, each
 * with its fixed label and the per-period statistic facts as inputs (V2's `theil_sen` and `mann_kendall` rules). `dim` is
 * the dimension's label name. Empty with fewer periods than the trend test needs.
 */
export function trendCalcs(metric: string, dimension: string, dim: string, t: ConcentrationTrend): Calc[] {
  if (t.periods.length < MIN_PERIODS.trend) return [];
  const one = (name: string, part: "hhi" | "top1_share", ys: readonly number[], unit: Calc["unit"], label: string): Calc[] => {
    const inputs = t.periods.map((p) => periodStat(metric, dimension, part, p));
    return [
      {
        name: `${name}_slope`,
        label: `${label} slope per period`,
        value: theilSen(ys),
        unit,
        fn: "theil_sen",
        inputs,
        factLabel: `${part}.${dim}.trend.slope`,
      },
      {
        name: `${name}_p`,
        label: `${label} Mann–Kendall p-value`,
        value: mannKendall(ys).p,
        unit: "ratio",
        fn: "mann_kendall",
        inputs,
        factLabel: `${part}.${dim}.trend.p_value`,
      },
    ];
  };
  return [...one("hhi", "hhi", t.hhi, "ratio", "HHI"), ...one("top1", "top1_share", t.top1, "percent", "top-1 share")];
}

export interface DependenceInput {
  readonly metric: string;
  readonly total: Series;
  readonly dimension: string;
  /** The dimension's label name (§14), qualified when the metric is not the pack's. */
  readonly dim: string;
  readonly period: string;
  /** The first period of the trailing year, and the top-1 share then (undefined when that period has no member). */
  readonly start: string;
  readonly startShare: number | undefined;
  readonly members: readonly Member[];
  readonly trend: ConcentrationTrend;
  /** The series of the member that is on top at `period`, when it is kept (top members by volume always are). */
  readonly top?: Series;
}

/**
 * Single-customer dependence (§11.4): the top member's share at `period` is ≥ 30%, and either it was below 30% at the
 * start of the trailing year while the HHI trend is rising (p < 0.05), or the top member's own value is shrinking.
 */
export function dependence(a: DependenceInput): Insight | undefined {
  const share = statValue("top1_share", a.members);
  const named = a.members
    .filter((m) => m.key !== null && m.total > 0)
    .sort((x, y) => y.total - x.total || ((x.key ?? "") < (y.key ?? "") ? -1 : 1));
  if (share === undefined || share < TOP_SHARE_AT || named.length < 2) return undefined;
  const crossing = a.startShare !== undefined && a.startShare < TOP_SHARE_AT && rising(a.trend.hhi);
  const ys = a.top ? a.trend.periods.map((p) => valueAt(a.top as Series, p)) : [];
  const shrinking = ys.length >= MIN_PERIODS.trend && theilSen(ys) < 0 && mannKendall(ys).p < TREND_P;
  if (!crossing && !shrinking) return undefined;
  const calcs = trendCalcs(a.metric, a.dimension, a.dim, a.trend);
  if (shrinking && a.top) {
    const inputs = a.trend.periods.map((p) => point((a.top as Series).id, p));
    calcs.push(
      { name: "member_slope", label: "top member slope per period", value: theilSen(ys), unit: a.total.unit, fn: "theil_sen", inputs },
      { name: "member_p", label: "top member Mann–Kendall p-value", value: mannKendall(ys).p, unit: "ratio", fn: "mann_kendall", inputs },
    );
  }
  const p = Math.min(crossing ? mannKendall(a.trend.hhi).p : 1, shrinking ? mannKendall(ys).p : 1);
  return {
    template: "dependence.v1",
    series: a.total.id,
    metric: a.metric,
    period: a.period,
    direction: "flat",
    material: true,
    confidence: p < 0.01 ? "high" : "medium",
    calcs,
    roles: {
      top_share: periodStat(a.metric, a.dimension, "top1_share", a.period),
      hhi: periodStat(a.metric, a.dimension, "hhi", a.period),
      ...(crossing
        ? {
            share_start: periodStat(a.metric, a.dimension, "top1_share", a.start),
            hhi_slope: calcRef("hhi_slope"),
            hhi_p: calcRef("hhi_p"),
          }
        : {}),
      ...(shrinking && a.top
        ? { member_slope: calcRef("member_slope"), member_p: calcRef("member_p"), top_value: point(a.top.id, a.period) }
        : {}),
    },
    details: { dimension: a.dimension, top: named[0]?.key, members: named.length, crossing, shrinking },
    notes: [],
  };
}
