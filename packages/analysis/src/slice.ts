// Analysis on demand for the agent's tools (agent-and-verifier §3): `drill_down` runs the pre-defined
// contribution template on one metric/period/dimension slice, and `propose_scenario` computes an impact range
// (§5) on top of facts that already exist. Both only add facts (with computation records) after the ones
// already stored; neither accepts SQL or expressions from the model.
import type { Catalog, Grain } from "@agentic-analytics/metrics";
import { runMetric } from "@agentic-analytics/metrics";
import type { Citation, Fact, MetricDef } from "@agentic-analytics/schema";
import { sql, type Workspace } from "@agentic-analytics/store";
import { beyondKeys } from "./decompose.ts";
import { AnalysisError, FactBook, factOf, type SeriesInfo } from "./factbook.ts";
import { impactRange, type Scenario } from "./impact.ts";
import { otherFilter, persistFacts, type StoredDecomposition, type StoredInsight } from "./runner.ts";
import { benchmarkGap, topContributors } from "./templates.ts";
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
  const facts: Record<string, string> = { total: factOf(scope, "delta:total") };
  for (const c of insight.contribution?.contributors ?? []) {
    facts[`change:${c.key}`] = factOf(scope, c.delta.name);
    facts[`share:${c.key}`] = factOf(scope, c.share.name);
  }
  for (const [key, name] of insight.contribution ? beyondKeys(insight.contribution) : []) facts[key] = factOf(scope, name);
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
  const all = await readFacts(ws);
  const facts = new Map(all.map((f) => [f.id, f]));
  const external = externalFacts(all);
  const amount = (id: string) => {
    const f = facts.get(id);
    if (!f) throw new AnalysisError("UNKNOWN_FACT", `unknown fact ${id}`);
    // Web numbers never enter the user's money (agent-and-verifier §4).
    if (external.has(id)) throw new AnalysisError("EXTERNAL_FACT", `${id} comes from the web and can only feed a benchmark comparison`);
    return { ref: factRef(id), value: f.value };
  };
  for (const id of justifiedBy) {
    if (!facts.has(id)) throw new AnalysisError("UNKNOWN_FACT", `unknown fact ${id}`);
    if (external.has(id)) throw new AnalysisError("EXTERNAL_FACT", `${id} comes from the web and can only feed a benchmark comparison`);
  }
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
    low: factOf(scope, r.low.name),
    high: factOf(scope, r.high.name),
    params: r.params.map((p) => factOf(scope, p.name)),
    newFacts,
  };
}

// ── External benchmarks (agent-and-verifier §4) ─────────────────────────────────────────────────────────────

export interface QuotedRange {
  readonly low: number;
  readonly high: number;
  readonly unit: "percent" | "other";
  /** The exact text the numbers were read from (a substring of the quote). */
  readonly text: string;
}

// v0.x reads percentages only: a percent range can't be confused with counts, money or scale words, and it is
// the unit benchmarks are usually quoted in. Thousands separators ("1,000") never read as decimals.
const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)`;
/** A minus sign belongs to the number only when it doesn't follow a digit ("−3%", not the dash of "1–2%"). */
const SIGN = String.raw`(?<![\d.,])([-−]?)`;
const PCT = String.raw`\s*(?:%|percent\b|per cent\b)`;
const RANGE = new RegExp(String.raw`${SIGN}${NUM}(${PCT})?\s*(?:–|—|-|\bto\b)\s*${SIGN}${NUM}${PCT}(?!\s*(?:points|pp)\b)`, "i");
const SINGLE = new RegExp(String.raw`${SIGN}${NUM}${PCT}`, "i");
const num = (sign: string | undefined, s: string) =>
  (sign ? -1 : 1) * Number(/^\d{1,3}(,\d{3})+/.test(s) ? s.replace(/,/g, "") : s.replace(",", "."));

/**
 * The first percent range ("5–8%", "1 to 2 percent", "−5% to −2%") or single percentage ("−3%") in a quote, read
 * as written, signs included: parsing, not arithmetic. A single value is a range of one. Anything that isn't a
 * percentage is not read (undefined).
 */
export function parseQuotedRange(quote: string): QuotedRange | undefined {
  const r = RANGE.exec(quote);
  if (r) {
    const low = num(r[1], r[2] ?? "");
    const high = num(r[4], r[5] ?? "");
    if (Number.isFinite(low) && Number.isFinite(high) && low <= high) return { low, high, unit: "percent", text: r[0] };
  }
  const s = SINGLE.exec(quote);
  if (s) {
    const v = num(s[1], s[2] ?? "");
    if (Number.isFinite(v)) return { low: v, high: v, unit: "percent", text: s[0] };
  }
  return undefined;
}

/**
 * Facts that are, or are computed from, external (web) numbers. They may only be the range of a benchmark
 * (agent-and-verifier §4): never an input to scenarios, never the "own" side of a comparison.
 */
export function externalFacts(facts: readonly Fact[]): Set<string> {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const memo = new Map<string, boolean>();
  const isExternal = (id: string, seen = new Set<string>()): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    const f = byId.get(id);
    if (!f || seen.has(id)) return false;
    seen.add(id);
    const v = f.computation.fn === "external_quote" || (f.computation.inputs ?? []).some((x) => isExternal(x, seen));
    memo.set(id, v);
    return v;
  };
  return new Set(facts.filter((f) => isExternal(f.id)).map((f) => f.id));
}

export interface BenchmarkResult {
  readonly low: string;
  readonly high: string;
  readonly gap: string;
  readonly newFacts: Fact[];
}

/**
 * benchmark_gap.v1 (analysis-library §3) of an existing fact against a range quoted from an external source. The
 * range becomes two `external_quote` facts citing the quote (never mixed with the user's numbers); the gap is the
 * distance from the fact to the range (0 inside it).
 */
export async function benchmarkFacts(
  ws: Workspace,
  defs: readonly MetricDef[],
  catalog: Catalog,
  grain: Grain,
  ownFactId: string,
  external: { readonly range: QuotedRange; readonly source_id: string; readonly quote: string; readonly label: string },
): Promise<BenchmarkResult> {
  const all = await readFacts(ws);
  const own = all.find((f) => f.id === ownFactId);
  if (!own) throw new AnalysisError("UNKNOWN_FACT", `unknown fact ${ownFactId}`);
  if (externalFacts(all).has(own.id))
    throw new AnalysisError("EXTERNAL_FACT", `${ownFactId} comes from the web; compare one of the job's own facts`);
  if (own.unit !== "percent" || external.range.unit !== "percent")
    throw new AnalysisError("BAD_SLICE", `${ownFactId} is in ${own.unit}; only percentages are compared with quoted ranges in v0.x`);
  let n = await nextFactNumber(ws);
  const ext = (side: "low" | "high", value: number): Fact => ({
    id: `N${n++}`,
    label: `external ${external.label} (${side})`,
    value,
    unit: own.unit,
    computation: { kind: "function", fn: "external_quote", params: { text: external.range.text, side } },
    citations: [{ source_id: external.source_id, quote: external.quote }],
    verified: false,
  });
  const low = ext("low", external.range.low);
  const high = ext("high", external.range.high);
  await persistFacts(ws, [low, high]);
  // The template reads the own value from a series; its point ref is then pointed at the existing fact.
  const series: Series = {
    id: "benchmark:own",
    metric: own.metric_id ?? "external",
    unit: own.unit as Unit,
    points: [{ period: "own", value: own.value }],
  };
  const insight = benchmarkGap(
    { series, period: "own" },
    { low: factRef(low.id), high: factRef(high.id), lowValue: low.value, highValue: high.value },
  );
  if (!insight) throw new AnalysisError("NO_VALUE", "no value to compare");
  const calcs = insight.calcs.map((c) => ({ ...c, inputs: c.inputs.map((r) => (r.kind === "point" ? factRef(own.id) : r)) }));
  const book = new FactBook(ws, defs, catalog, grain, new Map(), new Set(defs.map((d) => d.id)), await nextFactNumber(ws));
  const scope = await book.calcs(calcs, `benchmark ${own.id} vs ${external.source_id}`, own.metric_id);
  await persistFacts(ws, book.facts);
  return { low: low.id, high: high.id, gap: factOf(scope, "gap"), newFacts: [low, high, ...book.facts] };
}
