// `--today` for analyze, metrics and run: a date off the calendar is refused here, in one line, instead of failing
// the job at PROFILE inside DuckDB's `::DATE` cast.
import { isCalendarDate } from "@agentic-analytics/schema";

/** The date a job runs as: `--today`, or the current UTC date. */
export const todayOf = (raw: string | undefined, now: () => Date = () => new Date()): string => raw ?? now().toISOString().slice(0, 10);

/** Why `--today` is refused, or undefined when it is absent or a real date. */
export function todayProblem(raw: string | undefined): string | undefined {
  if (raw === undefined || isCalendarDate(raw)) return undefined;
  return `--today "${raw}" is not a calendar date; give YYYY-MM-DD, e.g. 2026-07-01`;
}
