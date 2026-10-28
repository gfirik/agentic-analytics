// Top-N shares and the Herfindahl–Hirschman index (analysis-library §11.2), over the positive keyed members.
import type { Sql } from "@agentic-analytics/store";
import { statFact, statRow } from "./member-totals.sql.ts";
import { PARETO_EXPR } from "./pareto.sql.ts";
import type { ConcentrationPart, ParetoCuts, StatPart, TopN } from "./pareto.ts";

const top = (n: TopN) => `(SELECT coalesce(sum(total), 0) FROM curve WHERE rn <= ${n}) / NULLIF((SELECT t FROM tot), 0) * 100`;

/** The SQL expression of each concentration statistic. The top-N shares are stated by the caller only above N members. */
export const CONCENTRATION_EXPR: Readonly<Record<ConcentrationPart, string>> = {
  top1_share: top(1),
  top3_share: top(3),
  top5_share: top(5),
  top10_share: top(10),
  hhi: "(SELECT sum(power(total / NULLIF((SELECT t FROM tot), 0), 2)) FROM pos)",
};

const EXPR: Readonly<Record<StatPart, string>> = { ...PARETO_EXPR, ...CONCENTRATION_EXPR };

/** A concentration statistic as a fact's SQL over `source` (the metric grouped by period and `dimension` for the window). */
export const concentrationSql = (source: Sql, dimension: string, part: ConcentrationPart, cuts: ParetoCuts): Sql =>
  statFact(source, dimension, cuts, CONCENTRATION_EXPR[part]);

/** Every statistic of a window in one row (`pareto` and `concentration` parts, keyed by part name). */
export const windowStatsSql = (source: Sql, dimension: string, cuts: ParetoCuts): Sql => statRow(source, dimension, cuts, EXPR);
