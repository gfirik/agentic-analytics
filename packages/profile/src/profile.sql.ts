// Profiling SQL (ingestion spec §5). Every template takes checked identifiers and parameters only.
import { fragment, ident, idents, type Sql, sql } from "@agentic-analytics/store";

const detail = sql`NOT _is_total`;

export const columnStats = (table: string, column: string): Sql =>
  sql`SELECT count(*) AS n, count(${ident(column)}) AS non_null, count(DISTINCT ${ident(column)}) AS distinct_count,
      min(${ident(column)})::VARCHAR AS min_value, max(${ident(column)})::VARCHAR AS max_value
      FROM ${ident(table)} WHERE ${fragment(detail)}`;

export const topValues = (table: string, column: string, limit = 5): Sql =>
  sql`SELECT ${ident(column)}::VARCHAR AS value, count(*) AS n FROM ${ident(table)}
      WHERE ${fragment(detail)} AND ${ident(column)} IS NOT NULL GROUP BY 1 ORDER BY n DESC, value LIMIT ${limit}`;

export const numericCenter = (table: string, column: string): Sql =>
  sql`SELECT median(${ident(column)})::DOUBLE AS median, mad(${ident(column)})::DOUBLE AS mad FROM ${ident(table)} WHERE ${fragment(detail)}`;

/** Robust outliers: |x − median| / (1.4826 · MAD) > threshold (spec §5: 5). */
export const madOutliers = (table: string, column: string, median: number, mad: number, threshold = 5): Sql =>
  sql`SELECT _row FROM ${ident(table)} WHERE ${fragment(detail)} AND ${ident(column)} IS NOT NULL
      AND abs(${ident(column)} - ${median}) / (1.4826 * ${mad}) > ${threshold} ORDER BY _row`;

export const tableCounts = (table: string): Sql =>
  sql`SELECT count(*) AS row_count, count(*) FILTER (WHERE ${fragment(detail)}) AS detail_rows, count(*) FILTER (WHERE _is_total) AS total_rows
      FROM ${ident(table)}`;

/** Rows beyond the first of each group of identical values over `columns` (exact duplicates, or on a key). */
export const duplicateRows = (table: string, columns: readonly string[]): Sql =>
  sql`SELECT coalesce(sum(c - 1), 0)::BIGINT AS duplicates FROM (
        SELECT count(*) AS c FROM ${ident(table)} WHERE ${fragment(detail)} GROUP BY ${idents(columns)})`;

export const dateCoverage = (table: string, column: string): Sql =>
  sql`SELECT min(${ident(column)})::DATE::VARCHAR AS first, max(${ident(column)})::DATE::VARCHAR AS last,
      count(DISTINCT ${ident(column)}::DATE) AS days, count(DISTINCT date_trunc('week', ${ident(column)})) AS weeks,
      count(DISTINCT date_trunc('month', ${ident(column)})) AS months,
      count(*) FILTER (WHERE day(${ident(column)}) <> 1) AS not_first_of_month,
      count(DISTINCT dayofweek(${ident(column)})) AS weekdays
      FROM ${ident(table)} WHERE ${fragment(detail)} AND ${ident(column)} IS NOT NULL`;

/** Months between the first and last date with no rows at all. */
export const missingMonths = (table: string, column: string, first: string, last: string): Sql =>
  sql`WITH present AS (SELECT DISTINCT strftime(${ident(column)}, '%Y-%m') AS p FROM ${ident(table)} WHERE ${ident(column)} IS NOT NULL),
      expected AS (SELECT strftime(m, '%Y-%m') AS p FROM generate_series(date_trunc('month', ${first}::DATE), date_trunc('month', ${last}::DATE), INTERVAL 1 MONTH) AS g(m))
      SELECT p FROM expected WHERE p NOT IN (SELECT p FROM present) ORDER BY p`;

/** Implausibility: values within ±0.15 of a power of ten (10, 100, 1000) times the column median. */
export const powerOfTenJumps = (table: string, column: string, median: number): Sql =>
  sql`SELECT _row, ${ident(column)}::DOUBLE AS value, round(log10(${ident(column)} / ${median}))::INTEGER AS k
      FROM ${ident(table)} WHERE ${fragment(detail)} AND ${ident(column)} > 0
        AND abs(log10(${ident(column)} / ${median}) - round(log10(${ident(column)} / ${median}))) < 0.15
        AND round(log10(${ident(column)} / ${median})) BETWEEN 1 AND 3
      ORDER BY _row`;

/** Values at least half a decade away from the median (either side): many of them means a multi-modal column. */
export const farFromMedian = (table: string, column: string, median: number): Sql =>
  sql`SELECT count(*) AS n FROM ${ident(table)} WHERE ${fragment(detail)} AND ${ident(column)} > 0 AND abs(log10(${ident(column)} / ${median})) >= 0.5`;

export const negativeRows = (table: string, column: string): Sql =>
  sql`SELECT _row FROM ${ident(table)} WHERE ${fragment(detail)} AND ${ident(column)} < 0 ORDER BY _row`;

/** Percent columns hold fractions, so a rate above 100% is a value above 1. */
export const aboveOneRows = (table: string, column: string): Sql =>
  sql`SELECT _row FROM ${ident(table)} WHERE ${fragment(detail)} AND ${ident(column)} > 1 ORDER BY _row`;

export const futureDateRows = (table: string, column: string, today: string): Sql =>
  sql`SELECT _row FROM ${ident(table)} WHERE ${fragment(detail)} AND ${ident(column)}::DATE > ${today}::DATE ORDER BY _row`;

export const distinctValues = (table: string, column: string): Sql =>
  sql`SELECT ${ident(column)}::VARCHAR AS raw, count(*) AS n FROM ${ident(table)}
      WHERE ${fragment(detail)} AND ${ident(column)} IS NOT NULL GROUP BY 1 ORDER BY 1`;

/** Pairs of distinct normalized names with Jaro–Winkler similarity at or above `min` (DuckDB built-in). */
export const similarPairs = (names: readonly string[], min: number): Sql =>
  sql`WITH v AS (SELECT DISTINCT unnest(${JSON.stringify(names)}::VARCHAR[]) AS n)
      SELECT a.n AS a, b.n AS b, jaro_winkler_similarity(a.n, b.n) AS s FROM v a JOIN v b ON a.n < b.n
      WHERE jaro_winkler_similarity(a.n, b.n) >= ${min} ORDER BY a, b`;
