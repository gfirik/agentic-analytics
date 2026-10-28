// Metric → parameterized SQL (docs/specs/metric-layer.md §4): metric(id, period_range, dimension_filters?,
// group_by?). Every number a report shows comes through this compiler, so it is tied to a metric id and its SQL.
import type { Grain, MetricDef, RatioTerm } from "@agentic-analytics/schema";
import { ident, type Sql, type Workspace } from "@agentic-analytics/store";
import { type Catalog, type CatalogTable, NUMERIC_TYPES, PERIOD_COLUMN } from "./catalog.ts";
import { builder, compileExpr, compileFilter, exprColumns, parseExpression, parseFilter, type SqlBuilder } from "./lang.ts";

export type { Grain };

export interface MetricQuery {
  /** Inclusive period range at the grain, e.g. "2026-01" … "2026-06" for months. */
  readonly from: string;
  readonly to: string;
  readonly grain?: Grain;
  /** Dimension columns to group by (must exist in every table the metric reads). */
  readonly groupBy?: readonly string[];
  /** Extra filter in the metric language, e.g. "channel = 'wholesale'". */
  readonly where?: string;
}

export type MetricCompileCode =
  | "UNKNOWN_METRIC"
  | "UNKNOWN_TABLE"
  | "UNKNOWN_COLUMN"
  | "NOT_NUMERIC"
  | "NO_TIME_COLUMN"
  | "UNSUPPORTED_TYPE";

export class MetricCompileError extends Error {
  constructor(
    readonly code: MetricCompileCode,
    message: string,
  ) {
    super(message);
    this.name = "MetricCompileError";
  }
}

const q = (name: string) => ident(name).quoted;

/** A ratio's two sides. The type leaves them optional; a def that skipped validation may lack one. */
export function ratioTerms(def: MetricDef): readonly [RatioTerm, RatioTerm] {
  if (!def.numerator || !def.denominator)
    throw new MetricCompileError("UNSUPPORTED_TYPE", `ratio ${def.id} needs a numerator and a denominator`);
  return [def.numerator, def.denominator];
}

/** Period key at the job grain (lexically ordered, so BETWEEN works). */
export function periodExpr(column: string, grain: Grain): string {
  return periodOf(q(column), grain);
}

/**
 * The date a row is dated by: the time column, or for a table whose period is a year and a month column the first day of
 * that month (a year alone is January; a month outside 1–12 has no date). Columns are checked identifiers.
 */
export function timeExpr(table: CatalogTable | undefined, time: string): string {
  const parts = table?.periodParts;
  if (time !== PERIOD_COLUMN || !parts) return q(time);
  const [y, m] = [`CAST(${q(parts.year)} AS INTEGER)`, parts.month ? `CAST(${q(parts.month)} AS INTEGER)` : undefined];
  return m ? `CASE WHEN ${m} BETWEEN 1 AND 12 THEN make_date(${y}, ${m}, 1) END` : `make_date(${y}, 1, 1)`;
}

/** The period key of an already-quoted date expression. */
function periodOf(c: string, grain: Grain): string {
  switch (grain) {
    case "day":
      return `strftime(${c}, '%Y-%m-%d')`;
    case "week":
      return `strftime(${c}, '%G-W%V')`;
    case "month":
      return `strftime(${c}, '%Y-%m')`;
    case "quarter":
      return `(strftime(${c}, '%Y') || '-Q' || quarter(${c}))`;
    case "year":
      return `strftime(${c}, '%Y')`;
  }
}

interface Ctx {
  readonly defs: ReadonlyMap<string, MetricDef>;
  readonly catalog: Catalog;
  readonly b: SqlBuilder;
  readonly query: MetricQuery;
  readonly grain: Grain;
  readonly groups: readonly string[];
  readonly ctes: string[];
  readonly done: Map<string, string>;
}

/** What makes a count_distinct a cohort (analysis-library §8.1): the counted column and which side of its first line to keep. */
interface Cohort {
  readonly column: string;
  readonly kind: "new" | "returning";
}

/** One aggregate over one table, grouped by period (and groups), as a CTE. Returns the CTE name. */
function tableCte(
  ctx: Ctx,
  key: string,
  table: string,
  time: string,
  aggregate: (col: (n: string) => string) => string,
  filters: readonly string[],
  cohort?: Cohort,
): string {
  const existing = ctx.done.get(key);
  if (existing) return existing;
  const t = ctx.catalog.get(table);
  if (!t) throw new MetricCompileError("UNKNOWN_TABLE", `unknown table ${table}`);
  for (const g of ctx.groups)
    if (!t.columns.has(g)) throw new MetricCompileError("UNKNOWN_COLUMN", `group-by column "${g}" does not exist in ${table}`);
  const col = (n: string) => {
    if (!t.columns.has(n)) throw new MetricCompileError("UNKNOWN_COLUMN", `column "${n}" does not exist in ${table}`);
    return q(n);
  };
  const where = [
    "NOT _is_total",
    `${timeExpr(t, time)} IS NOT NULL`,
    ...filters.map((f) => compileFilter(parseFilter(f), ctx.b, col)),
    ...(ctx.query.where ? [compileFilter(parseFilter(ctx.query.where), ctx.b, col)] : []),
    `${periodOf(timeExpr(t, time), ctx.grain)} BETWEEN ${ctx.b.param(ctx.query.from)} AND ${ctx.b.param(ctx.query.to)}`,
    ...(cohort ? cohortConditions(ctx, cohort, time, table) : []),
  ];
  const groupCols = ctx.groups.map((g) => `${q(g)}`).join(", ");
  const name = `m${ctx.ctes.length + 1}`;
  ctx.ctes.push(
    `${name} AS (SELECT ${periodOf(timeExpr(t, time), ctx.grain)} AS period${groupCols ? `, ${groupCols}` : ""}, ${aggregate(col)} AS value FROM ${q(table)}${cohort ? cohortJoin(ctx, cohort, time, table, filters) : ""} WHERE ${where.join(" AND ")} GROUP BY ALL)`,
  );
  ctx.done.set(key, name);
  return name;
}

const FIRST = { key: '"_cohort_key"', first: '"_cohort_first"' };

/**
 * Each counted value's first line in the table (over the same filters, whatever the query's period range), so a
 * customer is "new" in the month of their first revenue line and "returning" after it.
 */
function cohortJoin(ctx: Ctx, cohort: Cohort, time: string, table: string, filters: readonly string[]): string {
  const t = ctx.catalog.get(table);
  const col = (n: string) => {
    if (!t?.columns.has(n)) throw new MetricCompileError("UNKNOWN_COLUMN", `column "${n}" does not exist in ${table}`);
    return q(n);
  };
  const where = [
    "NOT _is_total",
    `${timeExpr(t, time)} IS NOT NULL`,
    `${q(cohort.column)} IS NOT NULL`,
    ...filters.map((f) => compileFilter(parseFilter(f), ctx.b, col)),
  ];
  return ` JOIN (SELECT ${q(cohort.column)} AS ${FIRST.key}, min(${timeExpr(t, time)}) AS ${FIRST.first} FROM ${q(table)} WHERE ${where.join(" AND ")} GROUP BY ALL) AS _first ON ${q(table)}.${q(cohort.column)} = _first.${FIRST.key}`;
}

/** New: the period holds the first line. Returning: it is earlier. Neither is stated for the table's first period (no history). */
function cohortConditions(ctx: Ctx, cohort: Cohort, time: string, table: string): string[] {
  const at = timeExpr(ctx.catalog.get(table), time);
  const period = periodOf(at, ctx.grain);
  const first = periodOf(`_first.${FIRST.first}`, ctx.grain);
  return [
    `${first} ${cohort.kind === "new" ? "=" : "<"} ${period}`,
    `${period} > (SELECT min(${period}) FROM ${q(table)} WHERE NOT _is_total AND ${at} IS NOT NULL)`,
  ];
}

/**
 * Joins CTEs on period (and groups) and combines their values with `combine`. Each side gets its own alias
 * (`j0`, `j1`, …): the same CTE can appear twice (a ratio of a metric to itself), and `FROM m1 FULL JOIN m1` is a
 * duplicate-alias binder error in DuckDB (construction_supplier-v1, M13h).
 */
function joinCtes(ctx: Ctx, names: readonly string[], combine: (value: (i: number) => string) => string): string {
  const keys = ["period", ...ctx.groups.map((g) => q(g))];
  if (!names.length) throw new MetricCompileError("UNSUPPORTED_TYPE", "nothing to join");
  const alias = names.map((_, i) => `j${i}`);
  // Join on period and groups with IS NOT DISTINCT FROM, so a NULL group (e.g. no channel) matches itself;
  // each output key is the first non-null across the joined CTEs.
  const from = names
    .map((n, i) => {
      if (i === 0) return `${n} AS ${alias[0]}`;
      const on = keys
        .map(
          (k) =>
            `coalesce(${alias
              .slice(0, i)
              .map((a) => `${a}.${k}`)
              .join(", ")}) IS NOT DISTINCT FROM ${alias[i]}.${k}`,
        )
        .join(" AND ");
      return `FULL JOIN ${n} AS ${alias[i]} ON ${on}`;
    })
    .join(" ");
  const select = keys.map((k) => `coalesce(${alias.map((a) => `${a}.${k}`).join(", ")}) AS ${k}`).join(", ");
  const name = `m${ctx.ctes.length + 1}`;
  ctx.ctes.push(`${name} AS (SELECT ${select}, ${combine((i) => `${alias[i]}.value`)} AS value FROM ${from})`);
  return name;
}

function metricCte(ctx: Ctx, def: MetricDef): string {
  const cached = ctx.done.get(`metric:${def.id}`);
  if (cached) return cached;
  let name: string;
  switch (def.type) {
    case "ratio": {
      const term = (term: RatioTerm, side: string): string => {
        if ("metric" in term) {
          const ref = ctx.defs.get(term.metric);
          if (!ref) throw new MetricCompileError("UNKNOWN_METRIC", `${side} metric ${term.metric} is not defined`);
          return metricCte(ctx, ref);
        }
        const table = ctx.catalog.get(term.table);
        if (!table?.dateColumn) throw new MetricCompileError("NO_TIME_COLUMN", `${side} table ${term.table} has no date column`);
        const e = parseExpression(term.expression);
        return tableCte(
          ctx,
          `${def.id}:${side}`,
          term.table,
          table.dateColumn,
          (col) => `sum(${compileExpr(e, ctx.b, col)})`,
          term.filters ?? [],
        );
      };
      const [numerator, denominator] = ratioTerms(def);
      const n = term(numerator, "numerator");
      const d = term(denominator, "denominator");
      // Spec §2.3: ratios never divide by a sum that could be zero without a guard.
      const scale = def.unit === "percent" ? " * 100" : "";
      // No numerator rows in a period means 0 (e.g. no refunds that month); no denominator means unknown.
      name = joinCtes(ctx, [n, d], (v) => `coalesce(${v(0)}, 0) / NULLIF(${v(1)}, 0)${scale}`);
      break;
    }
    case "derived": {
      const e = parseExpression(def.expression ?? "");
      const refs = [...new Set(exprColumns(e))];
      const ctes = refs.map((r) => {
        const ref = ctx.defs.get(r);
        if (!ref) throw new MetricCompileError("UNKNOWN_METRIC", `derived metric references unknown metric ${r}`);
        return metricCte(ctx, ref);
      });
      // Additive inputs (sums, counts) with no rows in a period are 0 there; averages and ratios stay unknown.
      const additive = (r: string) => ["sum", "count", "count_distinct"].includes(ctx.defs.get(r)?.type ?? "");
      name = joinCtes(ctx, ctes, (v) =>
        compileExpr(e, ctx.b, (r) => (additive(r) ? `coalesce(${v(refs.indexOf(r))}, 0)` : v(refs.indexOf(r)))),
      );
      break;
    }
    default: {
      const table = def.table ?? "";
      const t = ctx.catalog.get(table);
      const time = def.time_column ?? t?.dateColumn;
      if (!t || !time) throw new MetricCompileError("NO_TIME_COLUMN", `metric ${def.id} has no table or time column`);
      const e = def.expression ? parseExpression(def.expression) : undefined;
      // Percent columns hold fractions; a percent-unit average is reported in percentage points.
      const percentPoints =
        def.type === "avg" && def.unit === "percent" && e && exprColumns(e).every((c) => t.columns.get(c)?.type === "percent")
          ? " * 100"
          : "";
      const aggregate = (col: (n: string) => string) => {
        const x = e ? compileExpr(e, ctx.b, col) : "*";
        switch (def.type) {
          case "sum":
            return `sum(${x})`;
          case "avg":
            return `avg(${x})${percentPoints}`;
          case "count":
            return `count(${x})`;
          case "count_distinct":
            return `count(DISTINCT ${x})`;
          default:
            throw new MetricCompileError("UNSUPPORTED_TYPE", `unsupported metric type ${def.type}`);
        }
      };
      const cohort = def.cohort && def.expression ? { column: def.expression, kind: def.cohort } : undefined;
      name = tableCte(ctx, `metric:${def.id}`, table, time, aggregate, def.filters ?? [], cohort);
      if (e)
        for (const c of exprColumns(e))
          if (def.type !== "count" && def.type !== "count_distinct" && !NUMERIC_TYPES.has(t.columns.get(c)?.type ?? "text"))
            throw new MetricCompileError("NOT_NUMERIC", `column ${c} is not numeric`);
    }
  }
  ctx.done.set(`metric:${def.id}`, name);
  return name;
}

/** Compiles one metric (with every metric it depends on) to a single parameterized statement. */
export function compileMetric(id: string, defs: readonly MetricDef[], catalog: Catalog, query: MetricQuery): Sql {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const def = byId.get(id);
  if (!def) throw new MetricCompileError("UNKNOWN_METRIC", `unknown metric ${id}`);
  const ctx: Ctx = {
    defs: byId,
    catalog,
    b: builder(),
    query,
    grain: query.grain ?? "month",
    groups: query.groupBy ?? [],
    ctes: [],
    done: new Map(),
  };
  for (const g of ctx.groups) ident(g);
  const last = metricCte(ctx, def);
  const order = ["period", ...ctx.groups.map((g) => q(g))].join(", ");
  return {
    text: `WITH ${ctx.ctes.join(",\n  ")}\nSELECT ${order}, value FROM ${last} ORDER BY ${order}`,
    params: ctx.b.params,
  };
}

export interface MetricRow {
  readonly period: string;
  readonly value: number | null;
  readonly [group: string]: string | number | null;
}

export async function runMetric(
  ws: Workspace,
  id: string,
  defs: readonly MetricDef[],
  catalog: Catalog,
  query: MetricQuery,
): Promise<MetricRow[]> {
  return ws.all<MetricRow>(compileMetric(id, defs, catalog, query));
}

export interface RowsQuery {
  /** The source table the rows come from (e.g. "t_t1"). */
  readonly table: string;
  /** `SELECT _row … ORDER BY _row LIMIT n` for the period. */
  readonly rows: Sql;
  /** `SELECT count(*) AS n …` for the period. */
  readonly count: Sql;
}

/**
 * The input rows behind one metric value (its citations): for every table the metric reads — following ratio
 * terms and derived references — the `_row` numbers of the detail rows that fall in the period and pass the
 * metric's filters (and an optional extra filter, e.g. a dimension member).
 */
export function compileMetricRows(
  id: string,
  defs: readonly MetricDef[],
  catalog: Catalog,
  query: {
    period: string /** The last period of a range that starts at `period`. */;
    through?: string;
    grain?: Grain;
    where?: string;
    limit?: number;
  },
): RowsQuery[] {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const grain = query.grain ?? "month";
  const out: RowsQuery[] = [];
  const seen = new Set<string>();
  const term = (table: string, time: string, filters: readonly string[]) => {
    const t = catalog.get(table);
    if (!t) throw new MetricCompileError("UNKNOWN_TABLE", `unknown table ${table}`);
    const col = (n: string) => {
      if (!t.columns.has(n)) throw new MetricCompileError("UNKNOWN_COLUMN", `column "${n}" does not exist in ${table}`);
      return q(n);
    };
    const build = (select: string, tail: string, limit?: number) => {
      const b = builder();
      const where = [
        "NOT _is_total",
        `${timeExpr(t, time)} IS NOT NULL`,
        ...filters.map((f) => compileFilter(parseFilter(f), b, col)),
        ...(query.where ? [compileFilter(parseFilter(query.where), b, col)] : []),
        query.through === undefined
          ? `${periodOf(timeExpr(t, time), grain)} = ${b.param(query.period)}`
          : `${periodOf(timeExpr(t, time), grain)} BETWEEN ${b.param(query.period)} AND ${b.param(query.through)}`,
      ];
      const lim = limit !== undefined ? ` LIMIT ${b.param(limit)}` : "";
      return { text: `SELECT ${select} FROM ${q(table)} WHERE ${where.join(" AND ")}${tail}${lim}`, params: b.params };
    };
    const key = JSON.stringify([table, time, filters]);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ table, rows: build("_row", " ORDER BY _row", query.limit ?? 50), count: build("count(*) AS n", "") });
  };
  const walk = (def: MetricDef, depth: number) => {
    if (depth > 20) throw new MetricCompileError("UNSUPPORTED_TYPE", "metric references are too deep");
    if (def.type === "ratio") {
      for (const x of ratioTerms(def)) {
        if ("metric" in x) {
          const ref = byId.get(x.metric);
          if (!ref) throw new MetricCompileError("UNKNOWN_METRIC", `unknown metric ${x.metric}`);
          walk(ref, depth + 1);
        } else {
          const time = catalog.get(x.table)?.dateColumn;
          if (!time) throw new MetricCompileError("NO_TIME_COLUMN", `table ${x.table} has no date column`);
          term(x.table, time, x.filters ?? []);
        }
      }
    } else if (def.type === "derived") {
      for (const r of new Set(exprColumns(parseExpression(def.expression ?? "")))) {
        const ref = byId.get(r);
        if (!ref) throw new MetricCompileError("UNKNOWN_METRIC", `unknown metric ${r}`);
        walk(ref, depth + 1);
      }
    } else {
      const time = def.time_column ?? catalog.get(def.table ?? "")?.dateColumn;
      if (!def.table || !time) throw new MetricCompileError("NO_TIME_COLUMN", `metric ${def.id} has no table or time column`);
      term(def.table, time, def.filters ?? []);
    }
  };
  const def = byId.get(id);
  if (!def) throw new MetricCompileError("UNKNOWN_METRIC", `unknown metric ${id}`);
  walk(def, 0);
  return out;
}
