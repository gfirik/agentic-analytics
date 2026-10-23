// A period carried by plain integer columns instead of a date: a year column, and a month-number column beside it
// (docs/specs/semantics.md §2.1 "Period parts"). The pair together is the period of an already-aggregated row.
import { headerTokens } from "./header.ts";
import { isDateType, type RoleCandidate, type RoleColumn, WEIGHTS } from "./score.ts";

const YEAR_WORDS = new Set(["year", "yr", "год", "yil"]);
const MONTH_WORDS = new Set(["month", "mon", "месяц", "oy"]);
export const YEAR_RANGE = { min: 1900, max: 2100 } as const;

const hasWord = (c: RoleColumn, words: ReadonlySet<string>) => headerTokens(c.label).some((t) => words.has(t));
const num = (s: string | null) => (s === null || s === "" ? Number.NaN : Number(s));

/** Whole numbers, every value inside the range, and a word of the kind in the header. */
const isYear = (c: RoleColumn) =>
  c.type === "integer" && hasWord(c, YEAR_WORDS) && num(c.min) >= YEAR_RANGE.min && num(c.max) <= YEAR_RANGE.max;
const isMonth = (c: RoleColumn) => c.type === "integer" && hasWord(c, MONTH_WORDS) && num(c.min) >= 1 && num(c.max) <= 12;

export interface PeriodParts {
  readonly year: string;
  readonly month?: string;
}

/**
 * The year column, and the month column beside it, when the table has no date column: with a date, a year or month
 * number is only a part of it. A month number with no year column beside it is not a period.
 */
export function periodParts(cols: readonly RoleColumn[]): PeriodParts | undefined {
  if (cols.some((c) => isDateType(c.type) && c.non_null > 0)) return undefined;
  const year = cols.find(isYear);
  if (!year) return undefined;
  const month = cols.find((c) => c !== year && isMonth(c));
  return { year: year.name, ...(month ? { month: month.name } : {}) };
}

/** The `period` candidate of a part column: name word, values in range, and no date column to carry the period. */
export function periodPartCandidate(kind: "year" | "month"): RoleCandidate {
  const evidence = [
    { signal: "name" as const, text: `header has a ${kind} word`, weight: WEIGHTS.nameEnds },
    {
      signal: "value" as const,
      text: kind === "year" ? "whole numbers in the range of years" : "whole numbers in the range of month numbers",
      weight: WEIGHTS.value,
    },
    { signal: "value" as const, text: "the table has no date column, so the year and month columns are its period", weight: WEIGHTS.value },
  ];
  return { role: "period", score: evidence.reduce((s, e) => s + e.weight, 0), evidence };
}
