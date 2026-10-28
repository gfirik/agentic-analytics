// The fact book: every number the analysis produces becomes a fact (report-schema §3) with a computation
// record and citations. Measured points carry the metric's SQL with its parameters and the input rows (from the
// metric compiler); derived numbers carry the function id and their input fact ids. Facts are created lazily,
// only for numbers an insight or decomposition actually references.
import type { Catalog, Grain } from "@agentic-analytics/metrics";
import { compileMetric, compileMetricRows, marginTerms, marginValue } from "@agentic-analytics/metrics";
import type { Citation, Fact, MetricDef } from "@agentic-analytics/schema";
import type { Workspace } from "@agentic-analytics/store";
import type { Calc, Ref, Series, StatRef } from "./types.ts";

export type AnalysisErrorCode =
  | "UNKNOWN_SERIES"
  | "NO_VALUE"
  | "CALC_UNDEFINED"
  | "CIRCULAR_CALCS"
  | "BAD_SLICE"
  | "UNKNOWN_FACT"
  | "EXTERNAL_FACT"
  | "DUPLICATE_LABEL";

export class AnalysisError extends Error {
  constructor(
    readonly code: AnalysisErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AnalysisError";
  }
}

/** Cited rows per fact are capped; the total count is kept in the computation params. */
export const MAX_CITED_ROWS = 50;

export interface SeriesInfo {
  readonly series: Series;
  readonly def: MetricDef;
  /** Extra filter in the metric language for a dimension member, e.g. "channel = 'wholesale'". */
  readonly where?: string;
}

/** The fact id a calc name resolved to in `scope`; a missing one is an error, never a silent "" (AGENTS.md §4). */
export function factOf(scope: ReadonlyMap<string, string>, name: string): string {
  const id = scope.get(name);
  if (id === undefined) throw new AnalysisError("CALC_UNDEFINED", `no fact for calc ${name}`);
  return id;
}

/** Makes the facts behind a `stat` reference (the Pareto and concentration templates, analysis-library §11). */
export interface StatResolver {
  resolve(ref: StatRef): Promise<string>;
}

export class FactBook {
  readonly facts: Fact[] = [];
  /** Set by the analysis that uses `stat` references. */
  stats?: StatResolver;
  private readonly byKey = new Map<string, string>();
  /** Fixed labels (analysis-library §14) → fact id: a label names one fact in a report. */
  private readonly byLabel = new Map<string, string>();
  /** The value of every fact with a fixed label, including facts stored earlier in the job (`known`). */
  private readonly labelled = new Map<string, number>();

  constructor(
    private readonly ws: Workspace,
    private readonly defs: readonly MetricDef[],
    private readonly catalog: Catalog,
    private readonly grain: Grain,
    private readonly series: ReadonlyMap<string, SeriesInfo>,
    /** Metric ids that may appear as `metric_id` on facts; default: every def. */
    private readonly reported: ReadonlySet<string> = new Set(defs.map((d) => d.id)),
    /** Number of the first new fact: later passes (agent tools) continue after the facts already stored. */
    private readonly firstId = 1,
  ) {}

  /** Facts stored earlier in the job: a fixed label they hold names them, so a later pass reuses them (§14). */
  known(facts: readonly Fact[]): void {
    for (const f of facts) {
      this.byLabel.set(f.label, f.id);
      this.labelled.set(f.id, f.value);
    }
  }

  /**
   * A fact measured by a fixed SQL template, under a fixed label (§14). The same label with the same value is that fact;
   * with another value it is an engine bug, never a second fact.
   */
  sqlFact(f: Omit<Fact, "id" | "verified">): string {
    const old = this.byLabel.get(f.label);
    if (old !== undefined) {
      const was = this.labelled.get(old) ?? Number.NaN;
      if (Math.abs(was - f.value) <= 1e-9 * Math.max(1, Math.abs(was), Math.abs(f.value))) return old;
      throw new AnalysisError("DUPLICATE_LABEL", `label ${f.label} would name two different facts`);
    }
    const id = this.nextId();
    this.facts.push({ ...f, id, verified: false });
    this.byLabel.set(f.label, id);
    this.labelled.set(id, f.value);
    return id;
  }

  private nextId(): string {
    return `N${this.firstId + this.facts.length}`;
  }

  /** The fact for a measured point (metric value for a period, maybe for one dimension member). */
  async point(seriesId: string, period: string): Promise<string> {
    const key = `point:${seriesId}@${period}`;
    const known = this.byKey.get(key);
    if (known) return known;
    const info = this.series.get(seriesId);
    if (!info) throw new AnalysisError("UNKNOWN_SERIES", `unknown series ${seriesId}`);
    // An additive metric (sum, count) with no rows in a period is 0 there: the SQL returns no row, the fact is 0
    // and cites nothing. For averages and ratios a missing value is unknown, so it can't become a fact.
    const found = info.series.points.find((p) => p.period === period)?.value;
    const additive = ["sum", "count", "count_distinct"].includes(info.def.type);
    const value = found === undefined && additive ? 0 : found;
    if (value === undefined || !Number.isFinite(value)) throw new AnalysisError("NO_VALUE", `no value for ${seriesId} at ${period}`);
    const margin = await this.marginPoint(info, period, value);
    if (margin) {
      this.byKey.set(key, margin);
      return margin;
    }
    const query = { from: period, to: period, grain: this.grain, ...(info.where ? { where: info.where } : {}) };
    const sql = compileMetric(info.def.id, this.defs, this.catalog, query);
    const citations: Citation[] = [];
    let total = 0;
    for (const rq of compileMetricRows(info.def.id, this.defs, this.catalog, {
      period,
      grain: this.grain,
      ...(info.where ? { where: info.where } : {}),
      limit: MAX_CITED_ROWS,
    })) {
      const rows = (await this.ws.all<{ _row: number }>(rq.rows)).map((r) => r._row);
      total += (await this.ws.one<{ n: number }>(rq.count))?.n ?? 0;
      const sourceId = this.catalog.get(rq.table)?.id ?? rq.table;
      if (rows.length) citations.push({ source_id: sourceId, rows });
    }
    const id = this.nextId();
    const member = info.series.member;
    this.facts.push({
      id,
      label: `${info.def.id}${member ? `[${member.dimension}=${member.value ?? "(none)"}]` : ""}_${period}`,
      value,
      unit: info.series.unit,
      ...(info.def.currency && info.series.unit === "currency" ? { currency: info.def.currency } : {}),
      ...(this.reported.has(info.def.id) ? { metric_id: info.def.id } : {}),
      computation: {
        kind: "sql",
        sql: sql.text,
        params: { ...Object.fromEntries(sql.params.map((p, i) => [`$${i + 1}`, p])), input_rows: total },
      },
      citations,
      verified: false,
    });
    this.byKey.set(key, id);
    return id;
  }

  /**
   * A margin value is a function of its two measured terms (analysis-library §9): `gross_margin` = revenue − cost and
   * `gross_margin_pct` = (revenue − cost) ÷ revenue × 100, with the revenue and cost facts of the same period and member
   * as inputs, so V2 recomputes it and V4 checks its terms. Undefined when the series is not a margin, a term has no
   * series for this member, or the terms do not give the measured value (then the SQL fact stands, as for any metric).
   */
  private async marginPoint(info: SeriesInfo, period: string, measured: number): Promise<string | undefined> {
    const terms = marginTerms(info.def, this.defs);
    if (!terms) return undefined;
    const m = info.series.member;
    const at = (metric: string) => `${metric}${m ? `|${m.dimension}=${m.value ?? "(none)"}` : ""}`;
    const [revenue, cost] = [at(terms.revenue), at(terms.cost)];
    if (!this.series.has(revenue) || !this.series.has(cost)) return undefined;
    const revenueId = await this.point(revenue, period);
    const costId = await this.point(cost, period);
    const value = marginValue(terms.fn, this.valueOf(revenueId), this.valueOf(costId));
    if (!Number.isFinite(value) || Math.abs(value - measured) > 1e-9 * Math.max(1, Math.abs(value), Math.abs(measured))) return undefined;
    const id = this.nextId();
    this.facts.push({
      id,
      label: `${info.def.id}${m ? `[${m.dimension}=${m.value ?? "(none)"}]` : ""}_${period}`,
      value,
      unit: info.series.unit,
      ...(info.def.currency && info.series.unit === "currency" ? { currency: info.def.currency } : {}),
      ...(this.reported.has(info.def.id) ? { metric_id: info.def.id } : {}),
      computation: { kind: "function", fn: terms.fn, inputs: [revenueId, costId] },
      citations: [],
      verified: false,
    });
    return id;
  }

  private valueOf(id: string): number {
    return this.facts.find((f) => f.id === id)?.value ?? Number.NaN;
  }

  /** The fact for a derived number; `scope` maps calc names (within one insight) to fact ids. */
  async calc(c: Calc, scope: Map<string, string>, context: string, metricId?: string): Promise<string> {
    const inputs: string[] = [];
    for (const r of c.inputs) inputs.push(await this.resolve(r, scope));
    const key = `calc:${context}:${c.name}`;
    const known = this.byKey.get(key);
    if (known) {
      scope.set(c.name, known);
      return known;
    }
    // A fixed label (§14) names one fact: the same calc reached from another decomposition is that fact, and a label
    // with a different value is an engine bug, never a second fact.
    const fixed = c.factLabel ? this.byLabel.get(c.factLabel) : undefined;
    if (fixed) {
      const was = this.labelled.get(fixed);
      if (was !== undefined && Math.abs(was - c.value) <= 1e-9 * Math.max(1, Math.abs(was), Math.abs(c.value))) {
        this.byKey.set(key, fixed);
        scope.set(c.name, fixed);
        return fixed;
      }
      throw new AnalysisError("DUPLICATE_LABEL", `label ${c.factLabel} would name two different facts`);
    }
    // Like point(): a derived number that isn't finite (a ratio over 0) can't become a fact.
    if (!Number.isFinite(c.value)) throw new AnalysisError("NO_VALUE", `no finite value for ${context}:${c.name}`);
    const id = this.nextId();
    const def = metricId ? this.defs.find((d) => d.id === metricId) : undefined;
    this.facts.push({
      id,
      label: c.factLabel ?? `${context}:${c.name}`,
      value: c.value,
      unit: c.unit,
      ...(c.unit === "currency" && def?.currency ? { currency: def.currency } : {}),
      ...(metricId && this.reported.has(metricId) && c.unit === (this.series.get(metricId)?.series.unit ?? "")
        ? { metric_id: metricId }
        : {}),
      computation: { kind: "function", fn: c.fn, inputs },
      citations: [],
      verified: false,
    });
    this.byKey.set(key, id);
    if (c.factLabel) {
      this.byLabel.set(c.factLabel, id);
      this.labelled.set(id, c.value);
    }
    scope.set(c.name, id);
    return id;
  }

  async resolve(r: Ref, scope: Map<string, string>): Promise<string> {
    if (r.kind === "point") return this.point(r.series, r.period);
    if (r.kind === "fact") return r.id;
    if (r.kind === "stat") {
      if (!this.stats) throw new AnalysisError("UNKNOWN_FACT", `no resolver for ${r.part} of ${r.metric}`);
      return this.stats.resolve(r);
    }
    const id = scope.get(r.name);
    if (!id) throw new AnalysisError("CALC_UNDEFINED", `calc ${r.name} is used before it is defined`);
    return id;
  }

  /** Records a list of calcs in order (inputs before dependents) and returns name → fact id. */
  async calcs(list: readonly Calc[], context: string, metricId?: string): Promise<Map<string, string>> {
    const scope = new Map<string, string>();
    const pending = [...list];
    // Calcs may reference later ones; resolve in dependency order.
    // Each pass resolves one calc or throws, so the loop ends.
    while (pending.length) {
      const i = pending.findIndex((c) => c.inputs.every((r) => r.kind !== "calc" || scope.has(r.name)));
      if (i < 0) throw new AnalysisError("CIRCULAR_CALCS", `circular calcs in ${context}`);
      const [c] = pending.splice(i, 1);
      if (c) await this.calc(c, scope, context, metricId);
    }
    return scope;
  }
}
