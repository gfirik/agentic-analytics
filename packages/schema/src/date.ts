// One check for a `YYYY-MM-DD` date given by a person (an API option, a CLI flag): the shape alone lets
// "2026-13-45" through, and it fails much later, inside DuckDB's `::DATE` cast at PROFILE.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date as `YYYY-MM-DD`. `Date.parse` rolls "2026-02-30" over to March 2, so the round trip refuses it. */
export function isCalendarDate(s: string): boolean {
  if (!DAY.test(s)) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}
