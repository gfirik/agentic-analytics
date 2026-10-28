// Facts for the Pareto and concentration statistics (analysis-library §11, §14). A `stat` reference becomes a SQL fact:
// the metric's own grouped query for the window goes through the fixed templates, the fact cites the metric's rows in the
// window, and its computation carries what V2 needs to recompute it in code (rules `pareto_class`, `top_n_share`, `hhi`).
// A window is read once for all its statistics, and its cited rows once.
import { type Catalog, compileMetric, compileMetricRows, type Grain } from "@agentic-analytics/metrics";
import type { Citation, MetricDef } from "@agentic-analytics/schema";
import type { Sql, Workspace } from "@agentic-analytics/store";
import { concentrationSql, windowStatsSql } from "./concentration.sql.ts";
import { columnsWithRole } from "./decomp-inputs.ts";
import { AnalysisError, type FactBook, MAX_CITED_ROWS, type StatResolver } from "./factbook.ts";
import { paretoSql } from "./pareto.sql.ts";
import {
  CONCENTRATION_PARTS,
  type ConcentrationPart,
  PARETO_CUTS,
  PARETO_PARTS,
  type ParetoCuts,
  type ParetoPart,
  type StatPart,
  TOP_NS,
} from "./pareto.ts";
import type { StatRef, Unit } from "./types.ts";

/** The roles whose column is a dimension to measure concentration over, and the name they carry in labels (§11, §14). */
export const DIMENSION_ROLES: Readonly<Record<string, readonly string[]>> = {
  customer: ["customer", "customer_id"],
  product: ["product", "product_id"],
  supplier: ["supplier", "supplier_id"],
  channel: ["channel"],
  location: ["location"],
  salesperson: ["salesperson"],
  product_group: ["product_group"],
};

/**
 * The label name of each of a table's columns, `<dim>` for the entity or role the column has (§14). A second column
 * with the same dimension is `<dim>~<column>`. Only columns with such a role are in `grouping`; every other column of
 * `columns` is named by itself, so a tool can measure any dimension of a metric with a label that stays unique.
 */
export async function dimensionLabels(
  ws: Workspace,
  tableId: string,
  columns: readonly string[],
): Promise<{ readonly labels: ReadonlyMap<string, string>; readonly grouping: readonly string[] }> {
  const labels = new Map<string, string>();
  const taken = new Set<string>();
  const give = (base: string, column: string) => {
    const label = taken.has(base) ? `${base}~${column}` : base;
    taken.add(label);
    labels.set(column, label);
  };
  for (const [dim, roles] of Object.entries(DIMENSION_ROLES))
    for (const column of await columnsWithRole(ws, tableId, roles)) if (columns.includes(column) && !labels.has(column)) give(dim, column);
  const grouping = [...labels.keys()];
  for (const column of columns) if (!labels.has(column)) give(column, column);
  return { labels, grouping };
}

const isPareto = (part: StatPart): part is ParetoPart => (PARETO_PARTS as readonly string[]).includes(part);

/** The fixed label of a statistic (§14); `dim` is the dimension's label name, qualified when the metric is not the pack's. */
export function statLabel(part: StatPart, dim: string, suffix: string): string {
  if (isPareto(part)) return `pareto.${part}.${dim}_${suffix}`;
  return `${part}.${dim}_${suffix}`;
}

const UNITS: Record<StatPart, Unit> = Object.fromEntries([
  ...PARETO_PARTS.map((p) => [
    p,
    p.endsWith("_value") || p === "nonpositive_value" || p === "unkeyed_value" ? "currency" : p.endsWith("_share") ? "percent" : "count",
  ]),
  ...CONCENTRATION_PARTS.map((p) => [p, p === "hhi" ? "ratio" : "percent"]),
]) as Record<StatPart, Unit>;

interface WindowRun {
  readonly source: Sql;
  readonly values: ReadonlyMap<string, number>;
  readonly citations: Citation[];
  readonly inputRows: number;
}

/** The parts that state what the curve left out, or how many members there are: true of any window. */
const ALWAYS: ReadonlySet<StatPart> = new Set(["members", "nonpositive_count", "nonpositive_value", "unkeyed_value"]);

/** What a statistic needs of its window for it to be stated: a top-N share needs more than N members (§11.2). */
function stated(part: StatPart, values: ReadonlyMap<string, number>): boolean {
  if (ALWAYS.has(part)) return true;
  const members = values.get("members") ?? 0;
  const n = (TOP_NS as readonly number[]).find((k) => part === `top${k}_share`);
  return members >= 1 && (n === undefined || n === 1 || members > n);
}

export class ConcentrationFacts implements StatResolver {
  private readonly windows = new Map<string, Promise<WindowRun>>();

  constructor(
    private readonly ws: Workspace,
    private readonly book: FactBook,
    private readonly defs: readonly MetricDef[],
    private readonly catalog: Catalog,
    private readonly grain: Grain,
    /** The label name of a metric's dimension column (`dimensionLabels`), qualified when the metric is not the pack's. */
    private readonly labelOf: (metric: string, column: string) => string,
    private readonly cuts: ParetoCuts = PARETO_CUTS,
  ) {}

  /** Every statistic of the window in one read, with the rows it cites. */
  async window(metric: string, dimension: string, from: string, to: string): Promise<WindowRun> {
    const key = JSON.stringify([metric, dimension, from, to]);
    let run = this.windows.get(key);
    if (!run) {
      run = this.read(metric, dimension, from, to);
      this.windows.set(key, run);
    }
    return run;
  }

  private async read(metric: string, dimension: string, from: string, to: string): Promise<WindowRun> {
    const source = compileMetric(metric, this.defs, this.catalog, { from, to, grain: this.grain, groupBy: [dimension] });
    const row = (await this.ws.all<Record<string, number | null>>(windowStatsSql(source, dimension, this.cuts)))[0] ?? {};
    const values = new Map<string, number>();
    for (const [part, v] of Object.entries(row)) if (v !== null && v !== undefined) values.set(part, Number(v));
    const citations: Citation[] = [];
    let inputRows = 0;
    for (const rq of compileMetricRows(metric, this.defs, this.catalog, {
      period: from,
      through: to,
      grain: this.grain,
      limit: MAX_CITED_ROWS,
    })) {
      const rows = (await this.ws.all<{ _row: number }>(rq.rows)).map((r) => r._row);
      inputRows += (await this.ws.one<{ n: number }>(rq.count))?.n ?? 0;
      const sourceId = this.catalog.get(rq.table)?.id ?? rq.table;
      if (rows.length) citations.push({ source_id: sourceId, rows });
    }
    return { source, values, citations, inputRows };
  }

  /** Whether the statistic is stated over the window (for the caller to skip rather than throw). */
  async has(ref: StatRef): Promise<boolean> {
    const run = await this.window(ref.metric, ref.dimension, ref.from, ref.to);
    return stated(ref.part, run.values) && run.values.has(ref.part);
  }

  async resolve(ref: StatRef): Promise<string> {
    const run = await this.window(ref.metric, ref.dimension, ref.from, ref.to);
    const value = run.values.get(ref.part);
    if (value === undefined || !stated(ref.part, run.values))
      throw new AnalysisError("NO_VALUE", `${ref.part} of ${ref.metric} by ${ref.dimension} is not stated for ${ref.from}…${ref.to}`);
    const query = isPareto(ref.part)
      ? paretoSql(run.source, ref.dimension, ref.part, this.cuts)
      : concentrationSql(run.source, ref.dimension, ref.part as ConcentrationPart, this.cuts);
    const def = this.defs.find((d) => d.id === ref.metric);
    const unit = UNITS[ref.part];
    return this.book.sqlFact({
      label: statLabel(ref.part, this.labelOf(ref.metric, ref.dimension), ref.suffix),
      value,
      unit,
      ...(unit === "currency" && def?.currency ? { currency: def.currency } : {}),
      computation: {
        kind: "sql",
        sql: query.text,
        params: {
          ...Object.fromEntries(query.params.map((p, i) => [`$${i + 1}`, p])),
          input_rows: run.inputRows,
          stat: { part: ref.part, a_cut: this.cuts.a, b_cut: this.cuts.b },
        },
      },
      citations: run.citations,
    });
  }
}
