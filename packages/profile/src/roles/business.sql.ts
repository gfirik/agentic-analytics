// The measurements behind the business-model inference (docs/specs/semantics.md §4). Each returns one `value`: a share of
// revenue (or of rows) in percent, so it can be a fact that V2 re-runs. Identifiers are checked; the member patterns
// are parameters. "The last 12 months" is the 12 calendar months that end with the table's latest month.
import { fragment, ident, type Sql, sql } from "@agentic-analytics/store";

const detail = sql`NOT _is_total`;
/**
 * Shares of revenue are sums of floating-point values, and DuckDB adds them in a thread-dependent order, so the last
 * binary digits vary from run to run (found as a doors-test mismatch at 1e-14). Six decimals of a percent keep the
 * fact identical across runs and re-runs (V2), and are far finer than any threshold in semantics §4.
 */
const DIGITS = 6;

/** Rows from the table's last 12 calendar months with an amount. */
const recent = (table: string, date: string, amount: string): Sql =>
  sql`SELECT * FROM ${ident(table)} WHERE ${fragment(detail)} AND ${ident(date)} IS NOT NULL AND ${ident(amount)} IS NOT NULL
        AND date_trunc('month', ${ident(date)}) > (SELECT max(date_trunc('month', ${ident(date)})) FROM ${ident(table)}) - INTERVAL 12 MONTH`;

/** Percent of the last 12 months' revenue held by customers with a run of 3 or more consecutive months, each within 5% of the one before. */
export const steadyShare = (table: string, date: string, amount: string, customer: string): Sql =>
  sql`WITH monthly AS (
        SELECT ${ident(customer)} AS c, date_trunc('month', ${ident(date)}) AS mo, sum(${ident(amount)}) AS v
        FROM ${ident(table)} WHERE ${fragment(detail)} AND ${ident(date)} IS NOT NULL AND ${ident(amount)} IS NOT NULL GROUP BY 1, 2),
      linked AS (
        SELECT c, mo, v, (lag(mo) OVER w = mo - INTERVAL 1 MONTH AND abs(v - lag(v) OVER w) <= 0.05 * abs(lag(v) OVER w)) AS stable
        FROM monthly WINDOW w AS (PARTITION BY c ORDER BY mo)),
      steady AS (
        SELECT DISTINCT c FROM (SELECT c, stable AND lag(stable) OVER (PARTITION BY c ORDER BY mo) AS run FROM linked) WHERE run AND c IS NOT NULL),
      last_year AS (SELECT c, v FROM monthly WHERE mo > (SELECT max(mo) FROM monthly) - INTERVAL 12 MONTH)
      SELECT round(100.0 * coalesce(sum(v) FILTER (WHERE c IN (SELECT c FROM steady)), 0) / nullif(sum(v), 0), ${DIGITS}) AS value FROM last_year`;

/** Percent of the last 12 months' revenue in rows whose channel matches a pattern (a regular expression, case-insensitive). */
export const channelShare = (table: string, date: string, amount: string, channel: string, pattern: string): Sql =>
  sql`WITH r AS (${fragment(recent(table, date, amount))})
      SELECT round(100.0 * coalesce(sum(${ident(amount)}) FILTER (WHERE regexp_matches(lower(${ident(channel)}), ${pattern})), 0)
        / nullif(sum(${ident(amount)}), 0), ${DIGITS}) AS value FROM r`;

/** Percent of the last 12 months' revenue held by the 10 largest customers. */
export const topTenShare = (table: string, date: string, amount: string, customer: string): Sql =>
  sql`WITH r AS (${fragment(recent(table, date, amount))}),
      by_customer AS (SELECT ${ident(customer)} AS c, sum(${ident(amount)}) AS v FROM r WHERE ${ident(customer)} IS NOT NULL GROUP BY 1
        ORDER BY v DESC, c LIMIT 10)
      SELECT round(100.0 * coalesce((SELECT sum(v) FROM by_customer), 0) / nullif((SELECT sum(${ident(amount)}) FROM r), 0), ${DIGITS}) AS value`;

/** Percent of the table's detail rows with no customer. */
export const missingShare = (table: string, customer: string): Sql =>
  sql`SELECT 100.0 * count(*) FILTER (WHERE ${ident(customer)} IS NULL) / nullif(count(*), 0) AS value
      FROM ${ident(table)} WHERE ${fragment(detail)}`;
