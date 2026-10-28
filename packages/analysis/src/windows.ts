// Period windows for the concentration analyses (analysis-library §11.1): the trailing year at the job's grain, the year
// before it, and the calendar years the data covers. Period labels sort as text at one grain (`2026-03`, `2025-Q4`,
// `2025-W51`, `2026-03-14`, `2026`), which is what the metric compiler's BETWEEN relies on.
import type { Grain } from "./baselines.ts";

export interface Window {
  readonly from: string;
  readonly to: string;
}

/** Periods in a "year" at each grain: 12 months, 4 quarters, 52 weeks, 365 days (§11.1). */
export const YEAR_LENGTH: Readonly<Record<Grain, number>> = { day: 365, week: 52, month: 12, quarter: 4, year: 1 };

const DAY_MS = 86_400_000;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The Monday of ISO week `week` of ISO year `year` (week 1 holds January 4). */
function isoMonday(year: number, week: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  const dow = new Date(jan4).getUTCDay() || 7;
  return jan4 - (dow - 1) * DAY_MS + (week - 1) * 7 * DAY_MS;
}

function isoWeekLabel(mondayMs: number): string {
  // The week belongs to the year of its Thursday.
  const thursday = new Date(mondayMs + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  return `${year}-W${pad(Math.floor((mondayMs - isoMonday(year, 1)) / (7 * DAY_MS)) + 1)}`;
}

/** The period `n` periods after `period` (before, when negative) at `grain`. */
export function shiftPeriod(period: string, grain: Grain, n: number): string {
  const num = (s: string | undefined) => Number(s ?? Number.NaN);
  switch (grain) {
    case "year":
      return String(num(period) + n);
    case "quarter": {
      const [y, q] = period.split("-Q");
      const i = num(y) * 4 + (num(q) - 1) + n;
      return `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;
    }
    case "month": {
      const [y, m] = period.split("-");
      const i = num(y) * 12 + (num(m) - 1) + n;
      return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
    }
    case "day": {
      const [y, m, d] = period.split("-");
      return isoDate(Date.UTC(num(y), num(m) - 1, num(d)) + n * DAY_MS);
    }
    case "week": {
      const [y, w] = period.split("-W");
      return isoWeekLabel(isoMonday(num(y), num(w)) + n * 7 * DAY_MS);
    }
  }
}

export interface TrailingWindows {
  /** The trailing year ending at the last period, or the whole range when the data is shorter. */
  readonly ttm: Window;
  /** The year before `ttm`, only when the data covers all of it. */
  readonly ttmPrev?: Window;
}

/** `ttm` and `ttm_prev` for data running from `first` to `last` (§11.1). */
export function trailingWindows(first: string, last: string, grain: Grain): TrailingWindows {
  const len = YEAR_LENGTH[grain];
  const start = shiftPeriod(last, grain, -(len - 1));
  if (start <= first) return { ttm: { from: first, to: last } };
  const prevTo = shiftPeriod(start, grain, -1);
  const prevFrom = shiftPeriod(prevTo, grain, -(len - 1));
  return { ttm: { from: start, to: last }, ...(prevFrom >= first ? { ttmPrev: { from: prevFrom, to: prevTo } } : {}) };
}

/** The calendar year `year` as a window at `grain` (a finer grain than a year only). */
export function calendarYear(year: number, grain: Grain): Window | undefined {
  switch (grain) {
    case "year":
      return undefined;
    case "quarter":
      return { from: `${year}-Q1`, to: `${year}-Q4` };
    case "month":
      return { from: `${year}-01`, to: `${year}-12` };
    case "day":
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    case "week":
      return { from: `${year}-W01`, to: shiftPeriod(`${year + 1}-W01`, "week", -1) };
  }
}

/** The calendar years whose every period lies within `first`…`last`, as `[year, window]`. */
export function completeYears(first: string, last: string, grain: Grain): [number, Window][] {
  if (grain === "year") return [];
  const out: [number, Window][] = [];
  for (let y = Number(first.slice(0, 4)); y <= Number(last.slice(0, 4)); y++) {
    const w = calendarYear(y, grain);
    if (w && w.from >= first && w.to <= last) out.push([y, w]);
  }
  return out;
}
