// Insight templates (docs/specs/analysis-library.md §3). Each is a pure function over series that returns an
// `Insight`: every number as a `Calc` (or a reference to a measured point), a materiality verdict, a
// confidence, and notes for tests skipped for lack of data (each becomes an open question).
import { type Baseline, chooseBaseline, type Grain, MIN_PERIODS, materiality, noiseBand } from "./baselines.ts";
import { type Contribution, contribution, type MemberChange } from "./decompose.ts";
import { hhi, MAD_SCALE, mad, mannKendall, mean, median, sse, theilSen, twoProportionZ } from "./stats.ts";
import { type Calc, type Confidence, calcRef, type Point, point, type Ref, type Series } from "./types.ts";

export type TemplateId =
  | "period_change.v1"
  | "trend.v1"
  | "trend_break.v1"
  | "anomaly.v1"
  | "top_contributors.v1"
  | "concentration.v1"
  | "new_lost.v1"
  | "mix_shift.v1"
  | "ratio_shift.v1"
  | "benchmark_gap.v1";

export interface Insight {
  readonly template: TemplateId;
  readonly series: string;
  readonly metric: string;
  readonly member?: Series["member"];
  /** The period the insight is about (the latest period, or the first period after a break). */
  readonly period: string;
  readonly direction: "up" | "down" | "flat";
  readonly material: boolean;
  readonly confidence: Confidence;
  readonly calcs: readonly Calc[];
  /** Named roles → the numbers that fill them (e.g. before, after, change, change_pct). */
  readonly roles: Readonly<Record<string, Ref>>;
  /** Non-numeric details: baseline method, thresholds passed, members. */
  readonly details: Readonly<Record<string, unknown>>;
  /** Tests skipped for lack of data, or checks a reader should know about (open questions). */
  readonly notes: readonly string[];
  /** Decomposition attached by top_contributors.v1. */
  readonly contribution?: Contribution;
}

const dir = (x: number): Insight["direction"] => (x > 0 ? "up" : x < 0 ? "down" : "flat");
const pctChange = (name: string, after: Ref, before: Ref, a: number, b: number, unit: Calc["unit"] = "percent"): Calc => ({
  name,
  label: "percent change",
  value: b !== 0 ? (a / b - 1) * 100 : Number.NaN,
  unit,
  fn: "pct_change",
  inputs: [after, before],
});
const valuesOf = (points: readonly Point[]) => points.map((p) => p.value).filter(Number.isFinite);

function baselineRef(s: Series, b: Baseline, calcs: Calc[]): Ref {
  if (b.method !== "trailing_mean_3") return point(s.id, b.periods[0] ?? "");
  const c: Calc = {
    name: "baseline",
    label: "trailing mean of 3 periods",
    value: b.value,
    unit: s.unit,
    fn: "trailing_mean_3",
    inputs: b.periods.map((p) => point(s.id, p)),
  };
  calcs.push(c);
  return calcRef(c.name);
}

// ── period_change.v1 ───────────────────────────────────────────────────────────────────────────────────────

/** Latest period vs its baseline (spec §2): Δ, Δ%, and the three-part materiality test. */
export function periodChange(s: Series, grain: Grain = "month", minPct = 5): Insight | undefined {
  const i = s.points.length - 1;
  const last = s.points[i];
  const base = chooseBaseline(s.points, i, grain);
  if (!last || !base || !Number.isFinite(last.value)) return undefined;
  const calcs: Calc[] = [];
  const before = baselineRef(s, base, calcs);
  const after = point(s.id, last.period);
  const delta: Calc = {
    name: "change",
    label: "change",
    value: last.value - base.value,
    unit: s.unit,
    fn: "delta",
    inputs: [after, before],
  };
  const pct = pctChange("change_pct", after, before, last.value, base.value);
  calcs.push(delta, pct);
  const band = base.method === "previous_period" ? noiseBand(s.points, i) : undefined;
  const m = materiality(delta.value, pct.value, band, mean(valuesOf(s.points)), { minPct });
  return {
    template: "period_change.v1",
    series: s.id,
    metric: s.metric,
    ...(s.member ? { member: s.member } : {}),
    period: last.period,
    direction: dir(delta.value),
    material: m.material,
    confidence: m.confidenceCap ? "medium" : "high",
    calcs,
    roles: { before, after, change: calcRef("change"), change_pct: calcRef("change_pct") },
    details: { baseline: base.method, ...m, ...(band !== undefined ? { noise_band: band } : {}) },
    notes:
      band === undefined && base.method === "previous_period"
        ? ["Fewer than 6 periods: no noise band, so confidence is capped at medium."]
        : [],
  };
}

// ── trend.v1 ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Sustained direction: Theil–Sen slope + Mann–Kendall test, p < 0.05 (spec §3). Needs 4+ periods. */
export function trend(s: Series): Insight | { readonly skipped: string } {
  const pts = s.points.filter((p) => Number.isFinite(p.value));
  if (pts.length < MIN_PERIODS.trend)
    return { skipped: `Trend test needs ${MIN_PERIODS.trend}+ periods of ${s.metric}; only ${pts.length} available.` };
  const ys = pts.map((p) => p.value);
  const refs = pts.map((p) => point(s.id, p.period));
  const mk = mannKendall(ys);
  const slope: Calc = {
    name: "slope",
    label: "Theil–Sen slope per period",
    value: theilSen(ys),
    unit: s.unit,
    fn: "theil_sen",
    inputs: refs,
  };
  const p: Calc = { name: "p_value", label: "Mann–Kendall p-value", value: mk.p, unit: "ratio", fn: "mann_kendall", inputs: refs };
  return {
    template: "trend.v1",
    series: s.id,
    metric: s.metric,
    ...(s.member ? { member: s.member } : {}),
    period: pts[pts.length - 1]?.period ?? "",
    direction: dir(slope.value),
    material: mk.p < 0.05 && slope.value !== 0,
    confidence: mk.p < 0.01 ? "high" : "medium",
    calcs: [slope, p],
    roles: { slope: calcRef("slope"), p_value: calcRef("p_value"), first: refs[0] as Ref, last: refs[refs.length - 1] as Ref },
    details: { mann_kendall_s: mk.s, z: mk.z, periods: pts.length },
    notes: [],
  };
}

// ── trend_break.v1 ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Level shift (spec §3): the single split minimizing within-segment SSE, with at least 3 points per side;
 * material when the difference of the segment means exceeds the noise band. Reports the change across the
 * break (last point before → first after) and from the last point before to the latest point.
 */
export function trendBreak(s: Series, minPct = 5): Insight | { readonly skipped: string } {
  const pts = s.points.filter((p) => Number.isFinite(p.value));
  const side = MIN_PERIODS.break_side;
  if (pts.length < 2 * side) return { skipped: `Trend-break test needs ${side}+ periods on each side; ${s.metric} has ${pts.length}.` };
  let best = -1;
  let bestSse = Number.POSITIVE_INFINITY;
  for (let k = side; k <= pts.length - side; k++) {
    const total = sse(pts.slice(0, k).map((p) => p.value)) + sse(pts.slice(k).map((p) => p.value));
    if (total < bestSse) {
      bestSse = total;
      best = k;
    }
  }
  const left = pts.slice(0, best);
  const right = pts.slice(best);
  const lastBefore = left[left.length - 1] as Point;
  const firstAfter = right[0] as Point;
  const latest = pts[pts.length - 1] as Point;
  const ref = (p: Point) => point(s.id, p.period);
  const meanBefore: Calc = {
    name: "mean_before",
    label: "mean before the break",
    value: mean(left.map((p) => p.value)),
    unit: s.unit,
    fn: "mean",
    inputs: left.map(ref),
  };
  const meanAfter: Calc = {
    name: "mean_after",
    label: "mean after the break",
    value: mean(right.map((p) => p.value)),
    unit: s.unit,
    fn: "mean",
    inputs: right.map(ref),
  };
  const shift: Calc = {
    name: "shift",
    label: "level shift",
    value: meanAfter.value - meanBefore.value,
    unit: s.unit,
    fn: "delta",
    inputs: [calcRef("mean_after"), calcRef("mean_before")],
  };
  const breakChange: Calc = {
    name: "change",
    label: "change across the break",
    value: firstAfter.value - lastBefore.value,
    unit: s.unit,
    fn: "delta",
    inputs: [ref(firstAfter), ref(lastBefore)],
  };
  const breakPct = pctChange("change_pct", ref(firstAfter), ref(lastBefore), firstAfter.value, lastBefore.value);
  const since: Calc = {
    name: "change_since",
    label: "change from before the break to the latest period",
    value: latest.value - lastBefore.value,
    unit: s.unit,
    fn: "delta",
    inputs: [ref(latest), ref(lastBefore)],
  };
  const sincePct = pctChange("change_since_pct", ref(latest), ref(lastBefore), latest.value, lastBefore.value);
  const band = noiseBand(pts, best);
  const shiftPct = meanBefore.value !== 0 ? (shift.value / meanBefore.value) * 100 : Number.NaN;
  const material = band !== undefined && Math.abs(shift.value) > band && Math.abs(shiftPct) >= minPct;
  return {
    template: "trend_break.v1",
    series: s.id,
    metric: s.metric,
    ...(s.member ? { member: s.member } : {}),
    period: firstAfter.period,
    direction: dir(shift.value),
    material,
    confidence: pts.length >= 2 * side + 2 ? "high" : "medium",
    calcs: [meanBefore, meanAfter, shift, breakChange, breakPct, since, sincePct],
    roles: {
      before: ref(lastBefore),
      after: ref(firstAfter),
      latest: ref(latest),
      change: calcRef("change"),
      change_pct: calcRef("change_pct"),
      shift: calcRef("shift"),
      change_since: calcRef("change_since"),
      change_since_pct: calcRef("change_since_pct"),
    },
    details: { split_after: lastBefore.period, noise_band: band, shift_pct: shiftPct },
    notes: [],
  };
}

// ── anomaly.v1 ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Unusual periods (spec §3): the residual of each period vs its previous-period baseline, scored by robust z
 * against the other residuals; |z| > 3.5 is an anomaly if the change also clears the % and absolute
 * materiality thresholds (a tiny change can have a large z when the series is otherwise steady). Needs 6+ periods.
 */
export function anomalies(s: Series, threshold = 3.5, minPct = 5): Insight[] | { readonly skipped: string } {
  const pts = s.points.filter((p) => Number.isFinite(p.value));
  if (pts.length < MIN_PERIODS.anomaly)
    return { skipped: `Anomaly test needs ${MIN_PERIODS.anomaly}+ periods of ${s.metric}; only ${pts.length} available.` };
  const residuals = pts.slice(1).map((p, i) => p.value - (pts[i] as Point).value);
  const out: Insight[] = [];
  residuals.forEach((r, i) => {
    const others = residuals.filter((_, j) => j !== i);
    const center = median(others);
    const m = mad(others);
    const z = m > 0 ? (r - center) / (MAD_SCALE * m) : Number.NaN;
    const at = pts[i + 1] as Point;
    const prev = pts[i] as Point;
    // An unusual change must also be a real one: the % and absolute thresholds apply (spec §2 materiality).
    const pct = prev.value !== 0 ? (r / prev.value) * 100 : Number.NaN;
    const real = materiality(r, pct, undefined, mean(valuesOf(pts)), { minPct });
    if (!(Math.abs(z) > threshold) || !real.passesPct || !real.passesAbs) return;
    const residual: Calc = {
      name: "change",
      label: "change vs previous period",
      value: r,
      unit: s.unit,
      fn: "delta",
      inputs: [point(s.id, at.period), point(s.id, prev.period)],
    };
    const score: Calc = {
      name: "robust_z",
      label: "robust z of the change",
      value: z,
      unit: "other",
      fn: "robust_z",
      inputs: pts.map((p) => point(s.id, p.period)),
    };
    out.push({
      template: "anomaly.v1",
      series: s.id,
      metric: s.metric,
      ...(s.member ? { member: s.member } : {}),
      period: at.period,
      direction: dir(r),
      material: true,
      confidence: Math.abs(z) > 2 * threshold ? "high" : "medium",
      calcs: [residual, score],
      roles: { before: point(s.id, prev.period), after: point(s.id, at.period), change: calcRef("change"), robust_z: calcRef("robust_z") },
      details: { threshold },
      notes: [],
    });
  });
  return out;
}

// ── top_contributors.v1 ───────────────────────────────────────────────────────────────────────────────────────

/** Which members drove a material change (spec §3): additive contribution (§4.1). */
export function topContributors(
  total: Series,
  members: readonly MemberChange[],
  unit: Series["unit"],
  period: string,
  dimension: string,
): Insight {
  const c = contribution(members, unit);
  const top = c.contributors[0];
  return {
    template: "top_contributors.v1",
    series: total.id,
    metric: total.metric,
    period,
    direction: dir(c.totalDelta.value),
    material: true,
    confidence: "high",
    calcs: [c.totalDelta, ...c.contributors.flatMap((x) => [x.delta, x.share])],
    roles: {
      change: calcRef(c.totalDelta.name),
      ...(top ? { top_change: calcRef(top.delta.name), top_share: calcRef(top.share.name) } : {}),
    },
    details: { dimension, top: top?.key, positive: c.positive, negative: c.negative },
    notes: [],
    contribution: c,
  };
}

// ── concentration.v1 ──────────────────────────────────────────────────────────────────────────────────────────

/** Dependence on few members (spec §3): top-1 share ≥ 30% or HHI ≥ 0.25 at the period. */
export function concentration(
  metric: string,
  total: Series,
  members: readonly Series[],
  period: string,
  dimension: string,
): Insight | undefined {
  const vals = members.map((m) => ({ s: m, v: m.points.find((p) => p.period === period)?.value ?? 0 })).filter((x) => x.v > 0);
  const sum = vals.reduce((a, x) => a + x.v, 0);
  if (!sum || vals.length < 2) return undefined;
  vals.sort((a, b) => b.v - a.v);
  const top = vals[0] as { s: Series; v: number };
  const shares = vals.map((x) => x.v / sum);
  const refs = vals.map((x) => point(x.s.id, period));
  const topShare: Calc = {
    name: "top_share",
    label: `${top.s.member?.value ?? top.s.id} share`,
    value: (top.v / sum) * 100,
    unit: "percent",
    fn: "share",
    inputs: refs,
  };
  const index: Calc = { name: "hhi", label: "Herfindahl–Hirschman index", value: hhi(shares), unit: "ratio", fn: "hhi", inputs: refs };
  const material = topShare.value >= 30 || index.value >= 0.25;
  return {
    template: "concentration.v1",
    series: total.id,
    metric,
    period,
    direction: "flat",
    material,
    confidence: "high",
    calcs: [topShare, index],
    roles: { top_share: calcRef("top_share"), hhi: calcRef("hhi"), top_value: point(top.s.id, period) },
    details: { dimension, top: top.s.member?.value, members: vals.length },
    notes: [],
  };
}

// ── new_lost.v1 ───────────────────────────────────────────────────────────────────────────────────────────────

/** Members present in the baseline and absent now (value at risk), and the reverse (spec §3). */
export function newLost(
  metric: string,
  total: Series,
  members: readonly Series[],
  before: string,
  after: string,
  dimension: string,
): Insight | undefined {
  const val = (m: Series, p: string) => m.points.find((x) => x.period === p)?.value ?? 0;
  const lost = members.filter((m) => val(m, before) > 0 && val(m, after) === 0);
  const gained = members.filter((m) => val(m, before) === 0 && val(m, after) > 0);
  if (!lost.length && !gained.length) return undefined;
  const atRisk: Calc = {
    name: "lost_value",
    label: "value of lost members in the baseline",
    value: lost.reduce((a, m) => a + val(m, before), 0),
    unit: total.unit,
    fn: "sum",
    inputs: lost.map((m) => point(m.id, before)),
  };
  const added: Calc = {
    name: "new_value",
    label: "value of new members",
    value: gained.reduce((a, m) => a + val(m, after), 0),
    unit: total.unit,
    fn: "sum",
    inputs: gained.map((m) => point(m.id, after)),
  };
  return {
    template: "new_lost.v1",
    series: total.id,
    metric,
    period: after,
    direction: dir(added.value - atRisk.value),
    material: true,
    confidence: "high",
    calcs: [atRisk, added],
    roles: { lost_value: calcRef("lost_value"), new_value: calcRef("new_value") },
    details: { dimension, lost: lost.map((m) => m.member?.value), new: gained.map((m) => m.member?.value), baseline: before },
    notes: [],
  };
}

// ── mix_shift.v1 ──────────────────────────────────────────────────────────────────────────────────────────────

/** Share changes between members in percentage points; material if any moves ≥ 3 pp (spec §3). */
export function mixShift(
  metric: string,
  total: Series,
  members: readonly Series[],
  before: string,
  after: string,
  dimension: string,
  minPp = 3,
): Insight | undefined {
  const val = (m: Series, p: string) => m.points.find((x) => x.period === p)?.value ?? 0;
  const sum = (p: string) => members.reduce((a, m) => a + val(m, p), 0);
  const s0 = sum(before);
  const s1 = sum(after);
  if (!s0 || !s1) return undefined;
  const shifts = members
    .map((m) => ({ m, pp: (val(m, after) / s1 - val(m, before) / s0) * 100 }))
    .sort((a, b) => Math.abs(b.pp) - Math.abs(a.pp));
  const top = shifts[0];
  if (!top) return undefined;
  const refs = members.flatMap((m) => [point(m.id, before), point(m.id, after)]);
  const pp: Calc = {
    name: "share_shift_pp",
    label: `${top.m.member?.value ?? top.m.id} share change (pp)`,
    value: top.pp,
    unit: "percent",
    fn: "share_shift",
    inputs: refs,
  };
  return {
    template: "mix_shift.v1",
    series: total.id,
    metric,
    period: after,
    direction: dir(top.pp),
    material: Math.abs(top.pp) >= minPp,
    confidence: "high",
    calcs: [pp],
    roles: { share_shift_pp: calcRef("share_shift_pp") },
    details: { dimension, member: top.m.member?.value, baseline: before, threshold_pp: minPp },
    notes: [],
  };
}

// ── ratio_shift.v1 ────────────────────────────────────────────────────────────────────────────────────────────

export interface RatioCounts {
  readonly num: number;
  readonly den: number;
}

/**
 * Change in a rate metric (spec §3): a two-proportion z-test (p < 0.05) when the event counts are known,
 * else the noise band. The series values are the rate (percent or ratio).
 */
export function ratioShift(
  s: Series,
  counts?: { readonly before: RatioCounts; readonly after: RatioCounts },
  grain: Grain = "month",
): Insight | undefined {
  const base = periodChange(s, grain);
  if (!base) return undefined;
  if (!counts) return { ...base, template: "ratio_shift.v1", details: { ...base.details, test: "noise_band" } };
  const t = twoProportionZ(counts.before.num, counts.before.den, counts.after.num, counts.after.den);
  const p: Calc = {
    name: "p_value",
    label: "two-proportion z-test p-value",
    value: t.p,
    unit: "ratio",
    fn: "two_proportion_z",
    inputs: [base.roles.after as Ref, base.roles.before as Ref],
  };
  return {
    ...base,
    template: "ratio_shift.v1",
    material: t.p < 0.05,
    confidence: t.p < 0.01 ? "high" : "medium",
    calcs: [...base.calcs, p],
    roles: { ...base.roles, p_value: calcRef("p_value") },
    details: { ...base.details, test: "two_proportion_z", z: t.z },
  };
}

// ── benchmark_gap.v1 ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Own figure vs an external range (spec §3). Only with web extracts: the range comes from external facts
 * and the insight is always labelled external.
 */
export function benchmarkGap(
  own: { series: Series; period: string },
  range: { low: Ref; high: Ref; lowValue: number; highValue: number },
): Insight | undefined {
  const v = own.series.points.find((p) => p.period === own.period)?.value;
  if (v === undefined) return undefined;
  const ownRef = point(own.series.id, own.period);
  const gapValue = v > range.highValue ? v - range.highValue : v < range.lowValue ? v - range.lowValue : 0;
  const gap: Calc = {
    name: "gap",
    label: "gap to the external range",
    value: gapValue,
    unit: own.series.unit,
    fn: "benchmark_gap.v1",
    inputs: [ownRef, range.low, range.high],
  };
  return {
    template: "benchmark_gap.v1",
    series: own.series.id,
    metric: own.series.metric,
    period: own.period,
    direction: dir(gapValue),
    material: gapValue !== 0,
    confidence: "medium",
    calcs: [gap],
    roles: { own: ownRef, low: range.low, high: range.high, gap: calcRef("gap") },
    details: { external: true },
    notes: ["External benchmark: shown with the External badge and never mixed with the user's numbers."],
  };
}
