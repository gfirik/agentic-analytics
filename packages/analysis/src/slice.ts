// Analysis on demand for the agent's tools (agent-and-verifier §3): `drill_down` runs the pre-defined
// contribution template on one metric/period/dimension slice, and `propose_scenario` computes an impact range
// (§5) on top of facts that already exist. Both only add facts (with computation records) after the ones
// already stored; neither accepts SQL or expressions from the model.
import type { Catalog, Grain } from "@agentic-analytics/metrics";
import { runMetric } from "@agentic-analytics/metrics";
import type { Citation, Fact, MetricDef } from "@agentic-analytics/schema";
import { sql, type Workspace } from "@agentic-analytics/store";
import { AnalysisError, FactBook, type SeriesInfo } from "./factbook.ts";
import { impactRange, type Scenario } from "./impact.ts";
import { otherFilter, persistFacts, type StoredDecomposition, type StoredInsight } from "./runner.ts";
import { topContributors } from "./templates.ts";
import { factRef, OTHER, type Series, type Unit } from "./types.ts";

const UNITS: Record<string, Unit> = { currency: "currency", percent: "percent", count: "count", ratio: "ratio", days: "days" };
const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** Every fact stored in the job, in id order. */
export async function readFacts(ws: Workspace): Promise<Fact[]> {
  const rows = await ws.all<{
    id: string;
    label: string;
    value: number;
    unit: Fact["unit"];
    currency: string | null;
    metric_id: string | null;
    kind: "sql" | "function";
    sql: string | null;
    params: string | null;
    fn: string | null;
    inputs: string[] | null;
    input_rows: string | null;
  }>(sql`SELECT id, label, value, unit, currency, metric_id, kind, sql, params::VARCHAR AS params, fn, inputs,
      input_rows::VARCHAR AS input_rows FROM facts ORDER BY CAST(substr(id, 2) AS INTEGER)`);
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    value: r.value,
    unit: r.unit,
    ...(r.currency ? { currency: r.currency } : {}),
    ...(r.metric_id ? { metric_id: r.metric_id } : {}),
    computation: {
      kind: r.kind,
      ...(r.sql ? { sql: r.sql } : {}),
      ...(r.params ? { params: JSON.parse(r.params) as Record<string, unknown> } : {}),
      ...(r.fn ? { fn: r.fn } : {}),
      ...(r.inputs?.length ? { inputs: r.inputs } : {}),
    },
    citations: r.input_rows ? (JSON.parse(r.input_rows) as Citation[]) : [],
    verified: false,
  }));
}

/** The analysis as persisted by `analyzeJob`, for a resumed job. */
export async function loadAnalysis(ws: Workspace): Promise<{ insights: StoredInsight[]; decompositions: StoredDecomposition[] }> {
  const insights = await ws.all<{ payload: string }>(
    sql`SELECT payload::VARCHAR AS payload FROM insights ORDER BY CAST(substr(id, 2) AS INTEGER)`,
  );
  const decomps = await ws.all<{ payload: string }>(
    sql`SELECT payload::VARCHAR AS payload FROM decompositions ORDER BY CAST(substr(id, 2) AS INTEGER)`,
  );
  return {
    insights: insights.map((r) => JSON.parse(r.payload) as StoredInsight),
    decompositions: decomps.map((r) => JSON.parse(r.payload) as StoredDecomposition),
  };
}

/** The number the next new fact gets (N<k>). */
export async function nextFactNumber(ws: Workspace): Promise<number> {
  const r = await ws.one<{ n: number | null }>(sql`SELECT max(CAST(substr(id, 2) AS INTEGER)) AS n FROM facts`);
  return (r?.n ?? 0) + 1;
}

export interface DrillDownQuery {
  readonly metric: string;
  readonly period: string;
  readonly dimension: string;
  /** The job's period range: the slice compares `period` with the period before it in this range. */
  readonly range: { readonly from: string; readonly to: string; readonly grain: Grain };
  /** Members kept by name; the rest are grouped as "(other)". */
  readonly maxMembers?: number;
}

export interface DrillDownResult {
  readonly metric: string;
  readonly dimension: string;
  readonly before: string;
  readonly after: string;
  /** Fact ids: `total` (the change) and `change:<member>` / `share:<member>` per member. */
  readonly facts: Record<string, string>;
  readonly newFacts: Fact[];
}

/** contribution.v1 of one metric over one of its declared dimensions, `period` vs the period before. */
export async function drillDown(ws: Workspace, defs: readonly MetricDef[], catalog: Catalog, q: DrillDownQuery): Promise<DrillDownResult> {
  const def = defs.find((d) => d.id === q.metric);
  if (!def) throw new AnalysisError("BAD_SLICE", `unknown metric ${q.metric}`);
  if (def.type !== "sum" && def.type !== "count")
    throw new AnalysisError("BAD_SLICE", `${q.metric} is not additive; member changes would not add up`);
  if (!(def.dimensions ?? []).includes(q.dimension))
    throw new AnalysisError(
      "BAD_SLICE",
      `${q.dimension} is not a dimension of ${q.metric} (${(def.dimensions ?? []).join(", ") || "none"})`,
    );
  const totals = await runMetric(ws, def.id, defs, catalog, q.range);
  const periods = totals.map((r) => r.period).sort();
  const at = periods.indexOf(q.period);
  const before = at > 0 ? periods[at - 1] : undefined;
  if (at < 0 || !before) throw new AnalysisError("BAD_SLICE", `${q.period} has no previous period in ${q.range.from}…${q.range.to}`);
  const window = { from: before, to: q.period, grain: q.range.grain };
  const grouped = await runMetric(ws, def.id, defs, catalog, { ...window, groupBy: [q.dimension] });
  const unit = UNITS[def.unit] ?? "other";
  const byMember = new Map<string | null, Map<string, number>>();
  for (const r of grouped) {
    const key = (r[q.dimension] as string | null) ?? null;
    const m = byMember.get(key) ?? new Map<string, number>();
    m.set(r.period, Number(r.value ?? 0));
    byMember.set(key, m);
  }
  const change = (m: Map<string, number>) => Math.abs((m.get(q.period) ?? 0) - (m.get(before) ?? 0));
  const ranked = [...byMember.entries()].sort((a, b) => change(b[1]) - change(a[1]) || String(a[0]).localeCompare(String(b[0])));
  const keep = ranked.slice(0, q.maxMembers ?? 20);
  const series = new Map<string, SeriesInfo>();
  const filter = (v: string | null) => (v === null ? `${q.dimension} IS NULL` : `${q.dimension} = ${quote(v)}`);
  const members = keep.map(([value, m]) => {
    const s: Series = {
      id: `drill:${def.id}|${q.dimension}=${value ?? "(none)"}`,
      metric: def.id,
      unit,
      member: { dimension: q.dimension, value },
      points: [before, q.period].map((p) => ({ period: p, value: m.get(p) ?? 0 })),
    };
    series.set(s.id, { series: s, def, where: filter(value) });
    return s;
  });
  if (ranked.length > keep.length) {
    const where = otherFilter(
      q.dimension,
      keep.map(([v]) => v),
    );
    const rows = await runMetric(ws, def.id, defs, catalog, { ...window, where });
    const s: Series = {
      id: `drill:${def.id}|${q.dimension}=${OTHER}`,
      metric: def.id,
      unit,
      member: { dimension: q.dimension, value: OTHER },
      points: [before, q.period].map((p) => ({ period: p, value: Number(rows.find((r) => r.period === p)?.value ?? 0) })),
    };
    series.set(s.id, { series: s, def, where });
    members.push(s);
  }
  const total: Series = {
    id: `drill:${def.id}`,
    metric: def.id,
    unit,
    points: totals
      .filter((r) => r.period === before || r.period === q.period)
      .map((r) => ({ period: r.period, value: Number(r.value ?? 0) })),
  };
  series.set(total.id, { series: total, def });
  const insight = topContributors(
    total,
    members.map((m) => ({
      key: String(m.member?.value ?? "(none)"),
      series: m.id,
      before: { period: before, value: m.points[0]?.value ?? 0 },
      after: { period: q.period, value: m.points[1]?.value ?? 0 },
    })),
    unit,
    q.period,
    q.dimension,
  );
  const book = new FactBook(ws, defs, catalog, q.range.grain, series, new Set(defs.map((d) => d.id)), await nextFactNumber(ws));
  const scope = await book.calcs(insight.calcs, `drill_down ${def.id} ${q.period} by ${q.dimension}`, def.id);
  const facts: Record<string, string> = { total: scope.get("delta:total") ?? "" };
  for (const c of insight.contribution?.contributors ?? []) {
    facts[`change:${c.key}`] = scope.get(c.delta.name) ?? "";
    facts[`share:${c.key}`] = scope.get(c.share.name) ?? "";
  }
  await persistFacts(ws, book.facts);
  return { metric: def.id, dimension: q.dimension, before, after: q.period, facts, newFacts: book.facts };
}

/** Scenario inputs name existing facts; the values are read from the job, never taken from the model. */
export type ScenarioRequest =
  | { readonly type: "recover_share"; readonly lost: string; readonly low: number; readonly high: number; readonly discount?: number }
  | { readonly type: "price_change"; readonly revenue: string; readonly low: number; readonly high: number }
  | {
      readonly type: "remove_excess_rate";
      readonly current: string;
      readonly baseline: string;
      readonly base: string;
      readonly low: number;
      readonly high: number;
    }
  | { readonly type: "retain_at_risk"; readonly atRisk: string; readonly low: number; readonly high: number; readonly cost?: number };

export interface ScenarioResult {
  readonly method: string;
  readonly formula: string;
  readonly low: string;
  readonly high: string;
  readonly params: readonly string[];
  readonly newFacts: Fact[];
}

/** impact.v1 (analysis-library §5) over existing facts; `justifiedBy` fact ids become the parameters' inputs. */
export async function scenarioFacts(
  ws: Workspace,
  defs: readonly MetricDef[],
  catalog: Catalog,
  grain: Grain,
  req: ScenarioRequest,
  justifiedBy: readonly string[] = [],
): Promise<ScenarioResult> {
  const facts = new Map((await readFacts(ws)).map((f) => [f.id, f]));
  const amount = (id: string) => {
    const f = facts.get(id);
    if (!f) throw new AnalysisError("UNKNOWN_FACT", `unknown fact ${id}`);
    return { ref: factRef(id), value: f.value };
  };
  for (const id of justifiedBy) if (!facts.has(id)) throw new AnalysisError("UNKNOWN_FACT", `unknown fact ${id}`);
  const why = justifiedBy.map(factRef);
  const scenario: Scenario =
    req.type === "recover_share"
      ? {
          type: req.type,
          lost: amount(req.lost),
          low: req.low,
          high: req.high,
          ...(req.discount !== undefined ? { discount: req.discount } : {}),
          justifiedBy: why,
        }
      : req.type === "price_change"
        ? { type: req.type, revenue: amount(req.revenue), low: req.low, high: req.high, justifiedBy: why }
        : req.type === "remove_excess_rate"
          ? {
              type: req.type,
              current: amount(req.current),
              baseline: amount(req.baseline),
              base: amount(req.base),
              low: req.low,
              high: req.high,
              justifiedBy: why,
            }
          : {
              type: req.type,
              atRisk: amount(req.atRisk),
              low: req.low,
              high: req.high,
              ...(req.cost !== undefined ? { cost: req.cost } : {}),
              justifiedBy: why,
            };
  // The impact is in the unit of the amount it is computed from (money for every v0.1 scenario).
  const base = facts.get(
    req.type === "recover_share"
      ? req.lost
      : req.type === "price_change"
        ? req.revenue
        : req.type === "remove_excess_rate"
          ? req.base
          : req.atRisk,
  );
  const unit = (base?.unit ?? "currency") as Unit;
  const r = impactRange(scenario, unit);
  const book = new FactBook(ws, defs, catalog, grain, new Map(), new Set(defs.map((d) => d.id)), await nextFactNumber(ws));
  const context = `scenario ${r.method}`;
  const scope = await book.calcs([...r.params, r.low, r.high], context, base?.metric_id);
  // Currency follows the base fact (FactBook only knows currencies of metric series).
  const newFacts = book.facts.map((f) => (f.unit === "currency" && base?.currency ? { ...f, currency: base.currency } : f));
  await persistFacts(ws, newFacts);
  return {
    method: r.method,
    formula: r.formula,
    low: scope.get(r.low.name) ?? "",
    high: scope.get(r.high.name) ?? "",
    params: r.params.map((p) => scope.get(p.name) ?? ""),
    newFacts,
  };
}
