// Seasonal baselines (analysis-library §2, M13a): a one-period spike or dip is seasonal, not a finding, when the
// same calendar period in another year moved the same way by a similar amount. "One-period" means the value stands
// out from both of its neighbours, so a real level shift (a lost customer, a price change that sticks) is never
// mistaken for a season: its next period stays shifted. The newest period has no next neighbour, so it is never
// judged seasonal: a drop that starts there may be the start of a shift. Found by the eval suite, where every
// December peak was reported as a change.
import type { Grain } from "@agentic-analytics/metrics";
import type { Series } from "./types.ts";

/** Grains with a calendar year; seasonality is undefined for days and years. */
const SEASONAL: ReadonlySet<Grain> = new Set<Grain>(["week", "month", "quarter"]);
/** A period has to stand out from its neighbours by this much to be a spike at all. */
export const MIN_SPIKE = 0.08;
/** The other year's same period must move the same way, by between this share of the spike … */
export const SEASON_SHARE = 0.5;
/** … and this multiple of it: a +25% December against a +100% one is a seasonal shortfall, not the season. */
export const SEASON_MAX = 2;

/** How far a period stands out from both neighbours (relative to their mean); undefined at the edges or for a step. */
function spike(values: readonly number[], i: number): number | undefined {
  const v = values[i];
  const prev = values[i - 1];
  const next = values[i + 1];
  if (v === undefined || prev === undefined || next === undefined) return undefined;
  const base = (prev + next) / 2;
  if (base === 0) return undefined;
  // Both neighbours on the same side: a spike or a dip, not a step.
  if (Math.sign(v - prev) === 0 || Math.sign(v - prev) !== Math.sign(v - next)) return undefined;
  return v / base - 1;
}

/** The same calendar period `years` later ("2025-12" → "2026-12", "2025-Q4", "2025-W51"). */
const shiftYear = (period: string, years: number): string | undefined => {
  const m = /^(\d{4})(-.+)$/.exec(period);
  return m ? `${Number(m[1]) + years}${m[2]}` : undefined;
};

/**
 * When the period is a seasonal spike or dip, the matching period(s) of other years; otherwise undefined. Periods
 * are matched by calendar label, not by position, so a gap in the series can't pair the wrong months.
 */
export function seasonalMatch(s: Series, period: string, grain: Grain): string[] | undefined {
  if (!SEASONAL.has(grain)) return undefined;
  const periods = s.points.map((p) => p.period);
  const values = s.points.map((p) => p.value);
  const i = periods.indexOf(period);
  const d = spike(values, i);
  if (i < 0 || d === undefined || Math.abs(d) < MIN_SPIKE) return undefined;
  const matches: string[] = [];
  for (const k of [-2, -1, 1, 2]) {
    const p = shiftYear(period, k);
    const j = p === undefined ? -1 : periods.indexOf(p);
    const other = j < 0 ? undefined : spike(values, j);
    if (other === undefined || Math.sign(other) !== Math.sign(d)) continue;
    const ratio = Math.abs(other) / Math.abs(d);
    if (ratio >= SEASON_SHARE && ratio <= SEASON_MAX) matches.push(p as string);
  }
  return matches.length ? matches.sort() : undefined;
}

/**
 * True when an insight only reflects the season: its own period is a seasonal spike, or it is measured against a
 * seasonal period (January against a December peak) and, against the level outside that peak, it hasn't moved.
 * A January that fell below November's level is a real change and stays a finding.
 */
export function touchesSeason(s: Series, period: string, rolePeriods: readonly string[], grain: Grain): boolean {
  if (seasonalMatch(s, period, grain)) return true;
  const periods = s.points.map((p) => p.period);
  const value = (j: number) => s.points[j]?.value;
  const t = periods.indexOf(period);
  const v = value(t);
  if (v === undefined) return false;
  return rolePeriods.some((r) => {
    if (r === period || !seasonalMatch(s, r, grain)) return false;
    const j = periods.indexOf(r);
    // The level outside the peak, on the side away from the insight's period.
    const base = value(j < t ? j - 1 : j + 1);
    if (base === undefined || base === 0) return false;
    return Math.abs(v / base - 1) < MIN_SPIKE;
  });
}
