// pareto.v1 (analysis-library §11.1): the member count and value of each class A, B and C, the share of the positive
// total they hold, and what was left out of the curve. Each expression reads the CTEs of `member-totals.sql.ts`.
import type { Sql } from "@agentic-analytics/store";
import { statFact } from "./member-totals.sql.ts";
import type { ParetoClass, ParetoCuts, ParetoPart } from "./pareto.ts";

const inClass = (c: ParetoClass, what: string) => `(SELECT ${what} FROM classed WHERE cls = '${c}')`;

/** The SQL expression of each Pareto statistic. A share over a zero total is NULL (never stated). Sums run in a fixed order, so
 * a statistic is the same double on every run. */
export const PARETO_EXPR: Readonly<Record<ParetoPart, string>> = {
  a_count: inClass("a", "count(*)"),
  a_value: inClass("a", "coalesce(sum(total ORDER BY total DESC, key), 0)"),
  a_share: `${inClass("a", "coalesce(sum(total ORDER BY total DESC, key), 0)")} / NULLIF((SELECT t FROM tot), 0) * 100`,
  b_count: inClass("b", "count(*)"),
  b_value: inClass("b", "coalesce(sum(total ORDER BY total DESC, key), 0)"),
  b_share: `${inClass("b", "coalesce(sum(total ORDER BY total DESC, key), 0)")} / NULLIF((SELECT t FROM tot), 0) * 100`,
  c_count: inClass("c", "count(*)"),
  c_value: inClass("c", "coalesce(sum(total ORDER BY total DESC, key), 0)"),
  c_share: `${inClass("c", "coalesce(sum(total ORDER BY total DESC, key), 0)")} / NULLIF((SELECT t FROM tot), 0) * 100`,
  members: "(SELECT count(*) FROM pos)",
  nonpositive_count: "(SELECT count(*) FROM mem WHERE key IS NOT NULL AND total <= 0)",
  nonpositive_value: "(SELECT coalesce(sum(total ORDER BY total DESC, key), 0) FROM mem WHERE key IS NOT NULL AND total <= 0)",
  unkeyed_value: "(SELECT coalesce(sum(total), 0) FROM mem WHERE key IS NULL)",
};

/** A Pareto statistic as a fact's SQL over `source` (the metric grouped by period and `dimension` for the window). */
export const paretoSql = (source: Sql, dimension: string, part: ParetoPart, cuts: ParetoCuts): Sql =>
  statFact(source, dimension, cuts, PARETO_EXPR[part]);
