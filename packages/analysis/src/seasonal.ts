// Seasonal baselines (analysis-library §2, M13a): a one-period spike or dip is seasonal, not a finding, when the
// same calendar period in another year moved the same way. "One-period" means the value stands out from both of its
// neighbours, so a real level shift (a lost customer, a price change that sticks) is never mistaken for a season:
// its next period stays shifted. Found by the eval suite, where every December peak was reported as a change.
import type { Grain } from "@agentic-analytics/metrics";
import type { Series } from "./types.ts";

/** Periods per year at each grain; seasonality is undefined for days and years. */
const LAG: Partial<Record<Grain, number>> = { week: 52, month: 12, quarter: 4 };
/** A period has to stand out from its neighbours by this much to be a spike at all. */
export const MIN_SPIKE = 0.08;
/** The other year's same period must move the same way by at least this share of the spike. */
export const SEASON_SHARE = 0.5;

/** How far a period stands out from its neighbours (relative to their mean), or undefined at the edges. */
function spike(values: readonly number[], i: number): number | undefined {
  const v = values[i];
  const prev = values[i - 1];
  const next = values[i + 1];
  if (v === undefined || prev === undefined) return undefined;
  const base = next === undefined ? prev : (prev + next) / 2;
  if (base === 0) return undefined;
  const d = v / base - 1;
  // Both neighbours on the same side: a spike or a dip, not a step.
  if (next !== undefined && Math.sign(v - prev) !== Math.sign(v - next)) return undefined;
  return d;
}

/**
 * When the period is a seasonal spike or dip, the matching period(s) of other years; otherwise undefined.
 * The series' points are assumed to be consecutive periods in order (the runner measures every period of the range).
 */
export function seasonalMatch(s: Series, period: string, grain: Grain): string[] | undefined {
  const lag = LAG[grain];
  if (!lag) return undefined;
  const periods = s.points.map((p) => p.period);
  const values = s.points.map((p) => p.value);
  const i = periods.indexOf(period);
  const d = spike(values, i);
  if (i < 0 || d === undefined || Math.abs(d) < MIN_SPIKE) return undefined;
  const matches: string[] = [];
  for (const k of [-2 * lag, -lag, lag, 2 * lag]) {
    const other = spike(values, i + k);
    if (other !== undefined && Math.sign(other) === Math.sign(d) && Math.abs(other) >= SEASON_SHARE * Math.abs(d))
      matches.push(periods[i + k] as string);
  }
  return matches.length ? matches.sort() : undefined;
}

/**
 * True when an insight is about a seasonal period of its series, or compares against one: January measured against
 * a seasonal December peak looks like a drop but only reflects the season.
 */
export function touchesSeason(s: Series, period: string, rolePeriods: readonly string[], grain: Grain): boolean {
  return [period, ...rolePeriods].some((p) => seasonalMatch(s, p, grain) !== undefined);
}
