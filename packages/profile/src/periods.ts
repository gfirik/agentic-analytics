// Incomplete last period (ingestion spec §5, date coverage): day-level data that stops early in its last month
// (an export taken on the 9th) would compare a part-month with whole months and read as a collapse.

/** The share of its month the last date must reach for that month to count as complete. */
export const COMPLETE_SHARE = 0.75;

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * The last month ("2011-12") when it is incomplete: at month grain, the latest date in the data comes from day-
 * or week-level rows and falls before 75% of its month (day 23 of a 31-day month). Monthly data (one date per
 * month, on the 1st) is never partial. Undefined otherwise.
 */
export function partialLastMonth(
  tables: readonly { readonly date_last?: string; readonly grain?: "day" | "week" | "month" }[],
  jobGrain: string,
): string | undefined {
  if (jobGrain !== "month") return undefined;
  const latest = tables.filter((t) => t.date_last).sort((a, b) => (b.date_last as string).localeCompare(a.date_last as string))[0];
  const last = latest?.date_last;
  if (!last || latest.grain === "month") return undefined;
  const y = Number(last.slice(0, 4));
  const m = Number(last.slice(5, 7));
  const d = Number(last.slice(8, 10));
  return d / daysIn(y, m) < COMPLETE_SHARE ? last.slice(0, 7) : undefined;
}

/** The month before "YYYY-MM". */
export function previousMonth(p: string): string {
  const y = Number(p.slice(0, 4));
  const m = Number(p.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
