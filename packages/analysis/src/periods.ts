// A series over the job's periods (analysis-library §1, MEASURE): the time-series tests work by position, so a
// missing period must be a point, not a hole that makes March follow January.
import type { Point } from "./types.ts";

/**
 * `points` on every one of `periods` (sorted labels) that lies within the first..last period of `span` (the
 * metric's own total, or the series itself). A missing period is 0 for an additive metric and NaN (unknown)
 * otherwise. Outside the span nothing is added, so a table that starts later gets no zeros before its first row.
 */
export function fillPeriods(
  points: readonly Point[],
  periods: readonly string[],
  additive: boolean,
  span: readonly { period: string }[] = points,
): Point[] {
  const first = span[0]?.period;
  const last = span.at(-1)?.period;
  if (first === undefined || last === undefined) return [...points];
  const at = new Map(points.map((p) => [p.period, p.value]));
  return periods.filter((p) => p >= first && p <= last).map((period) => ({ period, value: at.get(period) ?? (additive ? 0 : Number.NaN) }));
}
