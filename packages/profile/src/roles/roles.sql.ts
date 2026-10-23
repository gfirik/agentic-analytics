// Cross-column identities of the role detector (docs/specs/semantics.md §2.2), checked in DuckDB. Each template takes
// checked identifiers and parameters only. Rows with a null in any term count neither way. The per-row tolerance is
// max(half a minor unit, 0.5% of |the amount the identity predicts|); the 1e-9 slack only absorbs binary rounding at
// an exact boundary (3 × 0.33 vs 1.00 stays a miss; 0.01 off a 100.00 line stays a hit).
import { fragment, ident, idents, type Sql, sql } from "@agentic-analytics/store";

const detail = sql`NOT _is_total`;
const SLACK = 1e-9;

/** Rows where q × p − d − a is within tolerance (d = 0 for the gross check, which passes no discount column). */
export const lineIdentity = (table: string, q: string, p: string, a: string, half: number, discount?: string): Sql => {
  const minus = discount ? sql` - ${ident(discount)}` : sql``;
  const notNull = discount
    ? sql`${ident(q)} IS NOT NULL AND ${ident(p)} IS NOT NULL AND ${ident(a)} IS NOT NULL AND ${ident(discount)} IS NOT NULL`
    : sql`${ident(q)} IS NOT NULL AND ${ident(p)} IS NOT NULL AND ${ident(a)} IS NOT NULL`;
  return sql`SELECT count(*) AS total,
      count(*) FILTER (WHERE abs(${ident(q)} * ${ident(p)}${fragment(minus)} - ${ident(a)}) <= greatest(${half}, 0.005 * abs(${ident(a)})) + ${SLACK}) AS matched
      FROM ${ident(table)} WHERE ${fragment(detail)} AND ${fragment(notNull)}`;
};

/** Rows where a − q × c is within tolerance of the margin column m. */
export const marginIdentity = (table: string, q: string, c: string, a: string, m: string, half: number): Sql =>
  sql`SELECT count(*) AS total,
      count(*) FILTER (WHERE abs(${ident(a)} - ${ident(q)} * ${ident(c)} - ${ident(m)}) <= greatest(${half}, 0.005 * abs(${ident(m)})) + ${SLACK}) AS matched
      FROM ${ident(table)} WHERE ${fragment(detail)} AND ${ident(q)} IS NOT NULL AND ${ident(c)} IS NOT NULL
        AND ${ident(a)} IS NOT NULL AND ${ident(m)} IS NOT NULL`;

/** Rows where the due date is on or after the issue date, and rows where it is strictly after. */
export const dateOrder = (table: string, issue: string, due: string): Sql =>
  sql`SELECT count(*) AS total, count(*) FILTER (WHERE ${ident(due)} >= ${ident(issue)}) AS matched,
      count(*) FILTER (WHERE ${ident(due)} > ${ident(issue)}) AS later
      FROM ${ident(table)} WHERE ${fragment(detail)} AND ${ident(issue)} IS NOT NULL AND ${ident(due)} IS NOT NULL`;

/** Detail rows, and how many distinct (date, dimensions) keys they hold: equal when the date and dimensions are a unique key. */
export const uniqueKey = (table: string, date: string, dimensions: readonly string[]): Sql =>
  sql`SELECT count(*) AS total, count(DISTINCT (${idents([date, ...dimensions])})) AS keys
      FROM ${ident(table)} WHERE ${fragment(detail)} AND ${ident(date)} IS NOT NULL`;
