// The scorecard (docs/specs/analysis-library.md §12): for each pack KPI, then margin, then the other sum, count and ratio
// metrics, the latest complete period's value, its change against the baseline baselines.ts chooses, its change against
// the same period a year earlier, and materiality. Built by code with no model call. Planning is pure: every number is a
// `Calc` over measured points, and `scorecardFacts` turns the plan into facts with the fixed labels of §14.
import { COSTED_REVENUE_METRIC, type Grain } from "@agentic-analytics/metrics";
import type { MetricDef, NotRunReason, Scorecard, ScorecardRow } from "@agentic-analytics/schema";
import { chooseBaseline, materiality, noiseBand } from "./baselines.ts";
import { type FactBook, factOf } from "./factbook.ts";
import { mean } from "./stats.ts";
import { type Calc, calcRef, type Point, point, type Ref, type Series } from "./types.ts";
import { shiftPeriod, YEAR_LENGTH } from "./windows.ts";

/** At most this many rows (§12). */
export const SCORECARD_ROWS = 12;

/** The pack KPIs in §8.1's order, then margin and margin % (§12 "Rows"). */
export const SCORECARD_ORDER = [
  "revenue",
  "orders",
  "units",
  "aov",
  "customers",
  "new_customers",
  "returning_customers",
  "refund_rate",
  "cancellation_rate",
  "discount_rate",
  "gross_margin",
  "gross_margin_pct",
] as const;

/** The other metrics a row may show (§12): sums, counts and ratios. Helper metrics of the margin pack are left out. */
const OTHER_TYPES = new Set<MetricDef["type"]>(["sum", "count", "ratio"]);

/**
 * The metrics that may have a row, in row order, before the cap: a metric with no value in the period has no row, so
 * `planScorecard` plans them first and then keeps the first `SCORECARD_ROWS`.
 */
export function scorecardMetrics(defs: readonly MetricDef[]): MetricDef[] {
  const order: readonly string[] = SCORECARD_ORDER;
  const pack = SCORECARD_ORDER.flatMap((id) => defs.filter((d) => d.id === id));
  const rest = defs.filter((d) => !order.includes(d.id) && d.id !== COSTED_REVENUE_METRIC && OTHER_TYPES.has(d.type));
  return [...pack, ...rest];
}

/**
 * Why there is no same-period-last-year column (§12): week and day are not compared, and a year needs the calendar span
 * of a year plus one (13 months, 5 quarters, 2 years) from the job's `first` period to `last`. The span counts calendar
 * periods, not periods with data, so a missing month inside the range doesn't hide a comparison; the year-ago point
 * itself must still have a value (`planRow`). Undefined when the comparison can be made.
 */
export function yoyGap(
  grain: Grain,
  first: string | undefined,
  last: string | undefined,
): Extract<NotRunReason, "too_few_periods" | "grain_not_comparable"> | undefined {
  if (grain === "week" || grain === "day") return "grain_not_comparable";
  if (first === undefined || last === undefined) return "too_few_periods";
  // Period labels sort as text at one grain (windows.ts).
  return shiftPeriod(last, grain, -YEAR_LENGTH[grain]) < first ? "too_few_periods" : undefined;
}

/** One row before its facts exist: the calcs to record and how the cells map to them. */
export interface RowPlan {
  readonly metric: string;
  readonly value: Ref;
  readonly calcs: readonly Calc[];
  readonly vsBase:
    | { readonly method: "previous_period" | "trailing_mean_3"; readonly periods: readonly string[] }
    | { readonly na: NotRunReason };
  readonly yoy: { readonly period: string } | { readonly na: NotRunReason };
  readonly material: boolean | null;
}

/** The points the band and mean read at most (the latest ones), like the concentration trend's cap (§11.3). */
export const BAND_PERIODS = 36;

const label = (metric: string, cell: string, period: string) => `scorecard.${metric}.${cell}_${period}`;

/**
 * A row for `s` at `period`, or undefined when the series has no value there (a ratio over nothing, or a table that ends
 * earlier). `first` is the job's first period: the calendar span from it to `period` decides whether a year can be compared.
 */
export function planRow(s: Series, period: string, grain: Grain, first: string): RowPlan | undefined {
  const i = s.points.findIndex((p) => p.period === period);
  const now = s.points[i];
  if (!now || !Number.isFinite(now.value)) return undefined;
  const value = point(s.id, period);
  const calcs: Calc[] = [];
  const cell = (name: string, v: number, fn: string, inputs: readonly Ref[], unit: Calc["unit"] = s.unit): Calc => ({
    name,
    label: name.replace(/_/g, " "),
    value: v,
    unit,
    fn,
    inputs,
    factLabel: label(s.metric, name, period),
  });
  const pct = (name: string, base: Ref, b: number) =>
    b > 0 ? [cell(name, (now.value / b - 1) * 100, "pct_change", [value, base], "percent")] : [];

  // vs baseline (§12): the previous period, or the trailing mean of 3 when it has no value; never last year's period.
  const base = chooseBaseline(s.points, i, grain, { sameLastYear: false });
  let vsBase: RowPlan["vsBase"] = { na: "too_few_periods" };
  let material: boolean | null = null;
  if (base) {
    let baseRef: Ref = point(s.id, base.periods[0] ?? "");
    if (base.method === "trailing_mean_3") {
      calcs.push({
        name: "base",
        label: "trailing mean of 3 periods",
        value: base.value,
        unit: s.unit,
        fn: "trailing_mean_3",
        inputs: base.periods.map((p) => point(s.id, p)),
      });
      baseRef = calcRef("base");
    }
    const change = cell("vs_base", now.value - base.value, "delta", [value, baseRef]);
    const changePct = pct("vs_base_pct", baseRef, base.value);
    calcs.push(change, ...changePct);
    // Materiality (§12, baselines.ts): the noise band over the series up to this period with the last change (the one
    // into this period) left out, and the series mean. With a previous-period base that change is the one tested; with a
    // trailing-mean base the tested change (against the mean) is not a change between points, and the one left out is
    // the change across the gap into this period, so no change into the period widens its own band (§12 "As built"). Only finite points are facts, so both are computed over those, as V2 recomputes them. At most
    // the last BAND_PERIODS of them: a daily series would otherwise make every day of the data a fact (as §11.3 caps).
    const known: Point[] = s.points
      .slice(0, i + 1)
      .filter((p) => Number.isFinite(p.value))
      .slice(-BAND_PERIODS);
    const refs = known.map((p) => point(s.id, p.period));
    const band = noiseBand(known, known.length - 1);
    const m = mean(known.map((p) => p.value));
    calcs.push(cell("mean", m, "mean", refs));
    if (band !== undefined) {
      calcs.push(cell("band", band, "noise_band", refs));
      material = materiality(change.value, changePct[0]?.value ?? Number.NaN, band, m).material;
    }
    vsBase = { method: base.method === "trailing_mean_3" ? "trailing_mean_3" : "previous_period", periods: [...base.periods] };
  }

  // vs the same period a year earlier (§12): 12 months, 4 quarters or 1 year back.
  let yoy: RowPlan["yoy"];
  const gap = yoyGap(grain, first, period);
  const yearAgo = gap ? undefined : shiftPeriod(period, grain, -YEAR_LENGTH[grain]);
  const then = yearAgo === undefined ? undefined : s.points.find((p) => p.period === yearAgo);
  if (gap) yoy = { na: gap };
  else if (!then || !Number.isFinite(then.value) || yearAgo === undefined) yoy = { na: "too_few_periods" };
  else {
    const thenRef = point(s.id, yearAgo);
    calcs.push(cell("yoy", now.value - then.value, "delta", [value, thenRef]), ...pct("yoy_pct", thenRef, then.value));
    yoy = { period: yearAgo };
  }
  return { metric: s.metric, value, calcs, vsBase, yoy, material };
}

/** The plans of every row (§12) at the report's last period; `periods` are the job's periods, sorted. */
export function planScorecard(
  defs: readonly MetricDef[],
  totals: ReadonlyMap<string, Series>,
  periods: readonly string[],
  grain: Grain,
): { readonly period: string; readonly rows: RowPlan[] } | undefined {
  const period = periods.at(-1);
  if (period === undefined) return undefined;
  // Planned before the cap: a metric with no value in the period gives its place to the next one.
  const rows = scorecardMetrics(defs)
    .flatMap((d) => {
      const s = totals.get(d.id);
      const plan = s ? planRow(s, period, grain, periods[0] ?? period) : undefined;
      return plan ? [plan] : [];
    })
    .slice(0, SCORECARD_ROWS);
  return { period, rows };
}

/** Records a plan's facts and returns the report section (report-schema §5b). */
export async function scorecardFacts(
  book: FactBook,
  plan: { readonly period: string; readonly rows: readonly RowPlan[] },
): Promise<Scorecard> {
  const rows: ScorecardRow[] = [];
  for (const r of plan.rows) {
    const scope = await book.calcs(r.calcs, `scorecard ${r.metric} ${plan.period}`, r.metric);
    const has = (name: string) => scope.has(name);
    const id = (name: string) => factOf(scope, name);
    rows.push({
      metric_id: r.metric,
      value: await book.resolve(r.value, scope),
      vs_base:
        "na" in r.vsBase
          ? { na: r.vsBase.na }
          : {
              method: r.vsBase.method,
              periods: [...r.vsBase.periods],
              change: id("vs_base"),
              ...(has("vs_base_pct") ? { change_pct: id("vs_base_pct") } : {}),
            },
      yoy:
        "na" in r.yoy
          ? { na: r.yoy.na }
          : { period: r.yoy.period, change: id("yoy"), ...(has("yoy_pct") ? { change_pct: id("yoy_pct") } : {}) },
      material: r.material,
      ...(has("mean") ? { materiality_inputs: { ...(has("band") ? { band: id("band") } : {}), mean: id("mean") } } : {}),
    });
  }
  return { period: plan.period, rows };
}
