// Date filters a planner model sends to a tool (agent-and-verifier §3, search_documents).
// Real planners send "", "2020-03" or "2020"; the schema must accept the call (a schema failure aborts the whole
// stage), and the handler normalises here or refuses just that call with a message the planner can act on.
// Dates are filters only: no reported number ever comes from this.

export type DateEdge = "from" | "to";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const YEAR = /^(\d{4})$/;

const pad = (n: number): string => String(n).padStart(2, "0");

/** Days in a month by the Gregorian rule (leap Februaries included), without going through Date. */
function daysIn(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export type NormalisedDate = { readonly ok: true; readonly date: string | undefined } | { readonly ok: false; readonly error: string };

/**
 * Turns what a model sent into a YYYY-MM-DD day, or `undefined` for an empty value (treated as absent).
 * `from` widens a month or year to its first day, `to` to its last, so "2020-03".."2020-04" covers both months whole.
 */
export function normaliseDateFilter(raw: string | undefined, edge: DateEdge): NormalisedDate {
  const v = raw?.trim() ?? "";
  if (v === "") return { ok: true, date: undefined };
  const bad = (): NormalisedDate => ({
    ok: false,
    error: `${edge} "${v}" is not a date: use YYYY-MM-DD, or YYYY-MM or YYYY for a whole month or year (or leave it empty)`,
  });
  const day = DAY.exec(v);
  const month = MONTH.exec(v);
  const year = YEAR.exec(v);
  if (!day && !month && !year) return bad();
  const y = Number((day ?? month ?? year)?.[1]);
  const m = day || month ? Number((day ?? month)?.[2]) : edge === "from" ? 1 : 12;
  const d = day ? Number(day[3]) : edge === "from" ? 1 : daysIn(y, m);
  if (m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return bad();
  return { ok: true, date: `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}` };
}
