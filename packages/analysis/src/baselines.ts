// Baselines, noise band and materiality (docs/specs/analysis-library.md §2).
import type { Grain } from "@agentic-analytics/metrics";
import { MAD_SCALE, mad, mean } from "./stats.ts";
import type { Point } from "./types.ts";

export type { Grain };
export type BaselineMethod = "same_period_last_year" | "previous_period" | "trailing_mean_3";

export interface Baseline {
  readonly method: BaselineMethod;
  readonly value: number;
  /** Periods the baseline is computed from. */
  readonly periods: readonly string[];
}

// Year-over-year is a monthly baseline only (spec §2: 13+ months of history); other grains go straight to the previous
// period.
const YEAR_LAG: Partial<Record<Grain, number>> = { month: 12 };

/** Minimum periods per test (spec §2 table). */
export const MIN_PERIODS = { trend: 4, anomaly: 6, yoy_months: 13, break_side: 3, mad_band: 6 } as const;

/**
 * The first baseline that applies (spec §2): same period last year (needs 13+ months of history), else the
 * previous period, else the trailing mean of the last 3 periods. `i` is the index of the target point. With
 * `sameLastYear: false` the first rule is skipped.
 */
export function chooseBaseline(
  points: readonly Point[],
  i: number,
  grain: Grain = "month",
  options: { readonly sameLastYear?: boolean } = {},
): Baseline | undefined {
  // The scorecard (§12) has its own year-on-year column, so its baseline starts at the previous period.
  const lag = options.sameLastYear === false ? undefined : YEAR_LAG[grain];
  const yearAgo = lag !== undefined ? points[i - lag] : undefined;
  if (lag !== undefined && points.length >= MIN_PERIODS.yoy_months && yearAgo && Number.isFinite(yearAgo.value)) {
    return { method: "same_period_last_year", value: yearAgo.value, periods: [yearAgo.period] };
  }
  const prev = points[i - 1];
  if (prev && Number.isFinite(prev.value)) return { method: "previous_period", value: prev.value, periods: [prev.period] };
  // The previous period is unknown here, so "the last 3 periods" means the last 3 with a value, looking back at
  // most 6 periods (a window that ends at i − 1 would always contain the missing point and never apply).
  const trailing = points
    .slice(Math.max(0, i - 6), i)
    .filter((p) => Number.isFinite(p.value))
    .slice(-3);
  if (trailing.length === 3)
    return { method: "trailing_mean_3", value: mean(trailing.map((p) => p.value)), periods: trailing.map((p) => p.period) };
  return undefined;
}

/**
 * Noise band for a change: 2 × 1.4826 × MAD of the series' other period-over-period changes (the change
 * being tested is left out so it can't widen its own band). Needs 6+ periods; otherwise undefined.
 */
export function noiseBand(points: readonly Point[], excludeChangeAt?: number): number | undefined {
  if (points.filter((p) => Number.isFinite(p.value)).length < MIN_PERIODS.mad_band) return undefined;
  const changes: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const c = (points[i] as Point).value - (points[i - 1] as Point).value;
    if (i !== excludeChangeAt && Number.isFinite(c)) changes.push(c);
  }
  if (changes.length === 0) return undefined;
  return 2 * MAD_SCALE * mad(changes);
}

export interface Materiality {
  readonly material: boolean;
  /** null when there was no MAD band (fewer than 6 periods). */
  readonly passesBand: boolean | null;
  readonly passesPct: boolean;
  readonly passesAbs: boolean;
  /** Fewer than 6 periods: no MAD band, so confidence is capped at medium. */
  readonly confidenceCap?: "medium";
}

export interface MaterialityOptions {
  /** Minimum |Δ%| (spec default 5). */
  readonly minPct?: number;
  /** Minimum |Δ| as a share of the series mean (spec default 1%). */
  readonly minAbsShare?: number;
}

/** A change is material only when it clears the noise band, the % threshold and the absolute threshold. */
export function materiality(
  delta: number,
  deltaPct: number,
  band: number | undefined,
  seriesMean: number,
  options: MaterialityOptions = {},
): Materiality {
  const passesBand = band === undefined ? null : Math.abs(delta) > band;
  const passesPct = Number.isFinite(deltaPct) && Math.abs(deltaPct) >= (options.minPct ?? 5);
  const passesAbs = Math.abs(delta) >= (options.minAbsShare ?? 0.01) * Math.abs(seriesMean);
  return {
    material: passesBand !== false && passesPct && passesAbs,
    passesBand,
    passesPct,
    passesAbs,
    ...(band === undefined ? { confidenceCap: "medium" as const } : {}),
  };
}
