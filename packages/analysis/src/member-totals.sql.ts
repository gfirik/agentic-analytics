// The member totals every Pareto and concentration statistic starts from (analysis-library §11): the metric's own
// grouped query for a window, summed per member, then the positive members as a ranked curve. The statistic itself
// (`pareto.sql.ts`, `concentration.sql.ts`) is one expression over these CTEs. Identifiers are checked, values are
// parameters, and the expressions are fixed text from this package, never from a model or a file.
import { fragment, ident, type Sql, sql } from "@agentic-analytics/store";
import type { ParetoCuts } from "./pareto.ts";

/** Per member: its value summed over the window. A null key stays one member (rows with no customer id). */
export function memberTotals(source: Sql, dimension: string): Sql {
  return sql`SELECT CAST(${ident(dimension)} AS VARCHAR) AS key, CAST(sum(value) AS DOUBLE) AS total FROM (${fragment(source)}) AS src GROUP BY 1`;
}

/**
 * The CTEs: `mem` (every member), `pos` (keyed members with a value above 0), `tot` (their total), `curve` (rank and
 * cumulative value) and `classed` (the class each reaches; the first is always A, and a relative tolerance lets a member
 * that reaches a cut-off exactly land on the lower class).
 */
export function memberCtes(source: Sql, dimension: string, cuts: ParetoCuts): Sql {
  return sql`mem AS (${fragment(memberTotals(source, dimension))}),
  pos AS (SELECT key, total FROM mem WHERE key IS NOT NULL AND total > 0),
  tot AS (SELECT coalesce(sum(total ORDER BY total DESC, key), 0) AS t FROM pos),
  curve AS (SELECT key, total,
    row_number() OVER (ORDER BY total DESC, key ASC) AS rn,
    sum(total) OVER (ORDER BY total DESC, key ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum FROM pos),
  classed AS (SELECT curve.*, CASE
      WHEN rn = 1 OR cum * 100 <= CAST(${cuts.a} AS DOUBLE) * t * (1 + 1e-12) THEN 'a'
      WHEN cum * 100 <= CAST(${cuts.b} AS DOUBLE) * t * (1 + 1e-12) THEN 'b'
      ELSE 'c' END AS cls FROM curve, tot)`;
}

/**
 * One statistic as a fact's SQL: a row per member with its total, and the statistic as `value` on every row. The fact's
 * value is `value`; V2 also reads the members' totals and recomputes the statistic in code from them (verify §7).
 */
export function statFact(source: Sql, dimension: string, cuts: ParetoCuts, expression: string): Sql {
  return sql`WITH ${fragment(memberCtes(source, dimension, cuts))}
SELECT mem.key, mem.total, ${fragment({ text: expression, params: [] })} AS value FROM mem ORDER BY mem.total DESC, mem.key`;
}

/** Several statistics of one window in one row, named by their keys: how the analysis reads a window once. */
export function statRow(source: Sql, dimension: string, cuts: ParetoCuts, expressions: Readonly<Record<string, string>>): Sql {
  const columns = Object.entries(expressions)
    .map(([name, expression]) => `${expression} AS "${name}"`)
    .join(",\n  ");
  return sql`WITH ${fragment(memberCtes(source, dimension, cuts))}
SELECT ${fragment({ text: columns, params: [] })}`;
}
