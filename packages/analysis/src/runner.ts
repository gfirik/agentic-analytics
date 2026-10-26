// MEASURE → DETECT → DECOMPOSE (ARCHITECTURE §2; docs/specs/analysis-library.md §1–6). Reads every metric
// through the metric compiler (SQL in DuckDB), runs the templates and decomposers, ranks the findings and
// records every number as a fact with its computation and citations (AGENTS.md §2.1–2.2).
import {
  type Catalog,
  type Grain,
  MARGIN_METRIC,
  marginDimensions,
  marginTerms,
  runMetric,
  sliceParents,
} from "@agentic-analytics/metrics";
import type { Fact, MetricDef } from "@agentic-analytics/schema";
import { sql, type Workspace } from "@agentic-analytics/store";
import { MIN_PERIODS } from "./baselines.ts";
import { marginItemDimension, pvmFor, pvmMarginFor, rateMixFor, valueAt } from "./decomp-inputs.ts";
import { cancelsOut, type Pvm, type RateMix } from "./decompose.ts";
import { FactBook, factOf, type SeriesInfo } from "./factbook.ts";
import { contributionFacts, memberFilter, otherFilter, unitOf } from "./members.ts";
import { fillPeriods } from "./periods.ts";
import type { PvmMargin } from "./pvm-margin.ts";
import { flaggedPeriods, touchesFlagged } from "./quality-guard.ts";
import { insightChange, type Ranked, rankInsights, TEMPLATE_PRIORITY, topForExplain } from "./rank.ts";
import { seasonalMatch, touchesSeason } from "./seasonal.ts";
import {
  anomalies,
  concentration,
  type Insight,
  mixShift,
  newLost,
  periodChange,
  ratioShift,
  topContributors,
  trend,
  trendBreak,
} from "./templates.ts";
import { OTHER, type Point, type Series } from "./types.ts";

export interface AnalyzeOptions {
  readonly from: string;
  readonly to: string;
  readonly grain?: Grain;
  /** The metric the objective is measured in (ranking); defaults to `revenue`, else the first money metric. */
  readonly objectiveMetric?: string;
  /** Members per dimension before the rest is folded into "other" (spec §1: 50). */
  readonly maxMembers?: number;
  /** Dimensions with more members than this get member-level series but no per-member templates. */
  readonly maxTemplateMembers?: number;
}

export interface StoredInsight {
  readonly id: string; // "I1"
  readonly template: string;
  readonly metric: string;
  readonly series: string;
  readonly member?: Series["member"];
  readonly period: string;
  readonly direction: Insight["direction"];
  readonly material: boolean;
  readonly confidence: Insight["confidence"];
  readonly score: number;
  /** role → fact id */
  readonly facts: Readonly<Record<string, string>>;
  readonly details: Readonly<Record<string, unknown>>;
  readonly notes: readonly string[];
}

export interface StoredDecomposition {
  readonly id: string; // "X1"
  readonly method: "contribution.v1" | "pvm.v1" | "pvm_margin.v1" | "ratemix.v1";
  readonly insight: string;
  readonly dimension: string;
  readonly facts: Readonly<Record<string, string>>;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AnalysisResult {
  readonly facts: Fact[];
  readonly insights: StoredInsight[];
  readonly decompositions: StoredDecomposition[];
  /** Ids of the insights that go to EXPLAIN (top 3–7, spec §6). */
  readonly top: string[];
  /** Per `top` entry: the best score in its event group (spec §6), which is what ordered it. */
  readonly topScores: number[];
  /** Tests skipped for lack of data and other open questions. */
  readonly openQuestions: string[];
}

export async function analyzeJob(
  ws: Workspace,
  defs: readonly MetricDef[],
  catalog: Catalog,
  options: AnalyzeOptions,
): Promise<AnalysisResult> {
  const grain = options.grain ?? "month";
  const maxMembers = options.maxMembers ?? 50;
  const maxTemplateMembers = options.maxTemplateMembers ?? 20;
  const range = { from: options.from, to: options.to, grain };
  const series = new Map<string, SeriesInfo>();
  const openQuestions: string[] = [];
  // Helper metrics (PVM quantities, ratio terms) are registered here so the fact book can compile their points.
  const allDefs: MetricDef[] = [...defs];
  const register = (d: MetricDef) => {
    if (!allDefs.some((x) => x.id === d.id)) allDefs.push(d);
  };

  // MEASURE (spec §1): every metric per period, and per dimension member (top N + "other").
  const totals: Series[] = [];
  const members = new Map<string, { dimension: string; series: Series[] }[]>();
  const measured = new Map<string, { period: string; value: number }[]>();
  for (const def of defs) {
    const rows = await runMetric(ws, def.id, defs, catalog, range);
    measured.set(
      def.id,
      rows.filter((r) => r.value !== null).map((r) => ({ period: r.period, value: Number(r.value) })),
    );
  }
  // Inside a metric's own first..last period, every series has every job period (a period where some metric has
  // data), so the time-series tests, which work by position, never compare March with January across a missing
  // February. Outside that span nothing is added: a table that starts later has no zeros before its first row, and
  // a period with no data at all stays a gap (profile's missing_periods). An additive metric is 0 where it has no
  // rows (FactBook.point makes the same 0 a fact); an average or ratio is unknown there (NaN, which the baselines and
  // templates skip). Spec analysis-library §1.
  const jobPeriods = [...new Set([...measured.values()].flatMap((ps) => ps.map((p) => p.period)))].sort();
  const fill = (points: readonly Point[], additive: boolean, span: readonly { period: string }[]) =>
    fillPeriods(points, jobPeriods, additive, span);
  for (const def of defs) {
    const unit = unitOf(def);
    const additive = def.type === "sum" || def.type === "count";
    // Margin is additive across members (revenue − cost per member), so it is split like a sum even though it is derived.
    const splittable = additive || isGrossMargin(def, defs);
    const own = measured.get(def.id) ?? [];
    const total: Series = { id: def.id, metric: def.id, unit, points: fill(own, additive || def.type === "count_distinct", own) };
    series.set(total.id, { series: total, def });
    totals.push(total);
    for (const dimension of splittable ? (isGrossMargin(def, defs) ? marginDimensions(def, defs) : (def.dimensions ?? [])) : []) {
      const grouped = await runMetric(ws, def.id, defs, catalog, { ...range, groupBy: [dimension] });
      const byMember = new Map<string | null, { period: string; value: number }[]>();
      for (const r of grouped) {
        const key = (r[dimension] as string | null) ?? null;
        byMember.set(key, [...(byMember.get(key) ?? []), { period: r.period, value: Number(r.value ?? 0) }]);
      }
      const ranked = [...byMember.entries()].sort((a, b) => sumAbs(b[1]) - sumAbs(a[1]) || String(a[0]).localeCompare(String(b[0])));
      const kept = ranked.slice(0, maxMembers);
      const list: Series[] = kept.map(([value, points]) => {
        const s: Series = {
          id: `${def.id}|${dimension}=${value ?? "(none)"}`,
          metric: def.id,
          unit,
          member: { dimension, value },
          points: fill(points, true, total.points),
        };
        series.set(s.id, { series: s, def, where: memberFilter(dimension, value) });
        return s;
      });
      if (ranked.length > maxMembers) {
        // The rest become one "(other)" member, so member changes still add up to the total. Its values come from
        // the same NOT IN query its facts cite, so a fact's value is exactly what its SQL returns.
        const rest = ranked.slice(maxMembers);
        const where = otherFilter(
          dimension,
          kept.map(([v]) => v),
        );
        const otherRows = await runMetric(ws, def.id, defs, catalog, { ...range, where });
        const s: Series = {
          id: `${def.id}|${dimension}=${OTHER}`,
          metric: def.id,
          unit,
          member: { dimension, value: OTHER },
          points: fill(
            otherRows.map((r) => ({ period: r.period, value: Number(r.value ?? 0) })),
            true,
            total.points,
          ),
        };
        series.set(s.id, { series: s, def, where });
        list.push(s);
        openQuestions.push(
          `${def.id} has ${ranked.length} ${dimension} members; the top ${maxMembers} are analysed and the other ${rest.length} are grouped as "${OTHER}".`,
        );
      }
      members.set(def.id, [...(members.get(def.id) ?? []), { dimension, series: list }]);
    }
  }

  // DETECT (spec §3).
  const found: Insight[] = [];
  for (const s of totals) {
    const def = series.get(s.id)?.def;
    // Spec §2: the same-period-last-year baseline needs 13+ months; say so rather than skip it silently.
    const known = s.points.filter((p) => Number.isFinite(p.value)).length;
    if (grain === "month" && known < MIN_PERIODS.yoy_months)
      openQuestions.push(`Year-over-year for ${s.metric} needs ${MIN_PERIODS.yoy_months}+ months; only ${known} available.`);
    const change = def?.type === "ratio" ? ratioShift(s, undefined, grain) : periodChange(s, grain);
    if (change) found.push(change);
    for (const r of [trend(s), trendBreak(s)]) {
      if ("skipped" in r) openQuestions.push(r.skipped);
      else found.push(r);
    }
    const a = anomalies(s);
    if ("skipped" in a) openQuestions.push(a.skipped);
    else found.push(...a);
  }
  for (const [metric, dims] of members) {
    const total = series.get(metric)?.series;
    // A margin's members are split in DECOMPOSE (contribution and margin PVM), not scanned for member findings of their own.
    if (!total || isGrossMargin(series.get(metric)?.def, defs)) continue;
    const periods = total.points.map((p) => p.period);
    const latest = periods[periods.length - 1];
    const previous = periods[periods.length - 2];
    for (const { dimension, series: list } of dims) {
      if (latest) {
        const c = concentration(metric, total, list, latest, dimension);
        if (c) found.push(c);
      }
      if (latest && previous) {
        const nl = newLost(metric, total, list, previous, latest, dimension);
        if (nl) found.push(nl);
        const mx = mixShift(metric, total, list, previous, latest, dimension);
        if (mx) found.push(mx);
      }
      if (list.length <= maxTemplateMembers) {
        for (const m of list) {
          const pc = periodChange(m, grain);
          if (pc?.material) found.push(pc);
        }
      }
    }
  }

  // DECOMPOSE (spec §4): every material change of an additive total is split over each dimension;
  // a break also gets the new/lost and mix checks across it.
  const decompositions: {
    insight: Insight;
    method: StoredDecomposition["method"];
    dimension: string;
    contribution?: Insight;
    pvm?: Pvm;
    pvmMargin?: PvmMargin;
    ratemix?: RateMix;
  }[] = [];
  // One decomposition per (series, before, after): several templates often detect the same change, and the
  // highest-priority one (trend break, then anomaly, …) carries it.
  const decomposed = new Set<string>();
  const byPriority = [...found].sort((a, b) => TEMPLATE_PRIORITY.indexOf(a.template) - TEMPLATE_PRIORITY.indexOf(b.template));
  for (const insight of byPriority) {
    if (
      !insight.material ||
      insight.member ||
      !["period_change.v1", "trend_break.v1", "anomaly.v1", "ratio_shift.v1"].includes(insight.template)
    )
      continue;
    const before = periodOf(insight.roles.before);
    const after = periodOf(insight.roles.after);
    if (!before || !after) continue;
    const once = `${insight.series}:${before}:${after}`;
    if (decomposed.has(once)) continue;
    decomposed.add(once);
    const def = series.get(insight.series)?.def;
    if (!def) continue;
    const marginTerm = isGrossMargin(def, allDefs) ? marginTerms(def, allDefs) : undefined;
    if (def.type === "sum" || def.type === "count" || marginTerm) {
      const itemDimension = marginTerm
        ? await marginItemDimension(
            ws,
            catalog,
            allDefs.find((d) => d.id === marginTerm.revenue),
            marginDimensions(def, allDefs),
          )
        : undefined;
      for (const { dimension, series: list } of members.get(def.id) ?? []) {
        const changes = list
          .map((m) => ({
            key: String(m.member?.value ?? "(none)"),
            series: m.id,
            before: { period: before, value: valueAt(m, before) },
            after: { period: after, value: valueAt(m, after) },
          }))
          .filter((c) => Number.isFinite(c.before.value) && Number.isFinite(c.after.value));
        if (changes.length < 2) continue;
        const total = series.get(def.id)?.series as Series;
        // A level shift can be material while its two edge points are equal (spec §3): with no change between them
        // there is nothing to split into shares. The other splits (new and lost members, mix, PVM) still run.
        if (!cancelsOut(changes))
          decompositions.push({
            insight,
            method: "contribution.v1",
            dimension,
            contribution: topContributors(total, changes, total.unit, after, dimension),
          });
        if (insight.template === "trend_break.v1") {
          const nl = newLost(def.id, total, list, before, after, dimension);
          if (nl) found.push(nl);
          const mx = mixShift(def.id, total, list, before, after, dimension);
          if (mx) found.push(mx);
        }
        const p = await pvmFor(ws, allDefs, register, catalog, def, dimension, list, before, after, range, series);
        if (p) decompositions.push({ insight, method: "pvm.v1", dimension, pvm: p });
        const items = members.get(marginTerm?.revenue ?? "")?.find((x) => x.dimension === dimension)?.series;
        if (marginTerm && items && dimension === itemDimension) {
          const pm = await pvmMarginFor(ws, allDefs, register, catalog, marginTerm, items, dimension, before, after, range, series);
          if (pm) decompositions.push({ insight, method: "pvm_margin.v1", dimension, pvmMargin: pm });
        }
      }
    }
    if (def.type === "ratio") {
      const r = await rateMixFor(ws, allDefs, register, catalog, def, before, after, range, series);
      if (r) decompositions.push({ insight, method: "ratemix.v1", dimension: r.dimension, ratemix: r.result });
    }
  }

  // A spike or dip that recurs in the same calendar period of another year is seasonal, not a finding.
  const seasonal = found.filter((i) => {
    const s = series.get(i.series)?.series;
    const roles = Object.values(i.roles).flatMap((r) => (r.kind === "point" && r.series === i.series ? [r.period] : []));
    return s ? touchesSeason(s, i.period, roles, grain) : false;
  });
  if (seasonal.length) {
    found.splice(0, found.length, ...found.filter((i) => !seasonal.includes(i)));
    for (const i of seasonal.filter((x, k, a) => a.findIndex((y) => y.series === x.series) === k)) {
      const s = series.get(i.series)?.series as Series;
      const label = defs.find((d) => d.id === i.metric)?.label ?? i.metric;
      const who = i.member ? ` for “${i.member.value}”` : "";
      const season = [
        i.period,
        ...Object.values(i.roles).flatMap((r) => (r.kind === "point" && r.series === i.series ? [r.period] : [])),
      ].find((p) => seasonalMatch(s, p, grain) !== undefined) as string;
      openQuestions.push(
        `"${label}"${who} in ${season} moved like ${(seasonalMatch(s, season, grain) ?? []).join(" and ")}: treated as seasonal, not reported as a finding.`,
      );
    }
  }

  // Changes that a flagged data error produces (a ×1000 cell) are data quality, not business findings.
  const flagged = await flaggedPeriods(ws, defs);
  const withheld = found.filter((i) => touchesFlagged(i, flagged));
  if (withheld.length) {
    found.splice(0, found.length, ...found.filter((i) => !withheld.includes(i)));
    for (const metric of new Set(withheld.map((i) => i.metric))) {
      const f = flagged.get(metric);
      const label = defs.find((d) => d.id === metric)?.label ?? metric;
      openQuestions.push(
        `Changes in "${label}" around ${[...(f?.periods ?? [])].sort().join(", ")} are not reported as findings: ${f?.why ?? "a flagged data error"}. Correct the value and run again.`,
      );
    }
  }

  // RANK (spec §6).
  const objective =
    options.objectiveMetric ?? (defs.find((d) => d.id === "revenue") ?? defs.find((d) => d.unit === "currency"))?.id ?? defs[0]?.id ?? "";
  const objectiveSeries = series.get(objective)?.series;
  const ranked = rankInsights(found, {
    objectiveMetric: objective,
    objectiveTotals: new Map((objectiveSeries?.points ?? []).map((p) => [p.period, p.value])),
    periods: objectiveSeries?.points.map((p) => p.period) ?? [],
    changeOf: insightChange,
  });

  // FACTS: record the numbers of every material insight and its decompositions.
  // Helper metrics (quantities, ratio terms) are compiled by the fact book but aren't report metrics, so their
  // facts carry no metric_id (report integrity only accepts ids from the metric list).
  const book = new FactBook(ws, allDefs, catalog, grain, series, new Set(defs.map((d) => d.id)));
  const stored: StoredInsight[] = [];
  const scoreOf = new Map<Insight, Ranked>(ranked.map((r) => [r.insight, r]));
  const material = found.filter((i) => i.material).sort((a, b) => (scoreOf.get(b)?.score ?? 0) - (scoreOf.get(a)?.score ?? 0));
  const idOf = new Map<Insight, string>();
  for (const insight of material) {
    const id = `I${stored.length + 1}`;
    // The id makes the context unique: one template on several dimensions of the same series and period (e.g.
    // concentration by customer and by channel) must never share derived facts.
    const context = `${id} ${insight.template} ${insight.series} ${insight.period}`;
    const scope = await book.calcs(insight.calcs, context, insight.metric);
    const facts: Record<string, string> = {};
    for (const [role, ref] of Object.entries(insight.roles)) facts[role] = await book.resolve(ref, scope);
    stored.push({
      id,
      template: insight.template,
      metric: insight.metric,
      series: insight.series,
      ...(insight.member ? { member: insight.member } : {}),
      period: insight.period,
      direction: insight.direction,
      material: insight.material,
      confidence: insight.confidence,
      score: scoreOf.get(insight)?.score ?? 0,
      facts,
      details: insight.details,
      notes: insight.notes,
    });
    idOf.set(insight, id);
  }
  const storedDecomp: StoredDecomposition[] = [];
  for (const d of decompositions) {
    const insightId = idOf.get(d.insight);
    if (!insightId) continue;
    const id = `X${storedDecomp.length + 1}`;
    const context = `${d.method} ${d.insight.series} ${d.insight.period} by ${d.dimension}`;
    const facts: Record<string, string> = {};
    let details: Record<string, unknown> = {};
    if (d.contribution) {
      const scope = await book.calcs(d.contribution.calcs, context, d.insight.metric);
      Object.assign(facts, contributionFacts(d.contribution.contribution, scope));
      facts.total = factOf(scope, "delta:total");
      details = { ...d.contribution.details };
    } else if (d.pvm) {
      const p = d.pvm;
      const calcs = [...p.parts, p.total];
      const scope = await book.calcs(calcs, context, d.insight.metric);
      for (const c of calcs) facts[c.name.replace("pvm:", "")] = factOf(scope, c.name);
    } else if (d.pvmMargin) {
      const p = d.pvmMargin;
      const calcs = [...p.parts, p.total];
      const scope = await book.calcs(calcs, context, d.insight.metric);
      for (const c of calcs) facts[c.name.replace("pvm_margin:", "")] = factOf(scope, c.name);
      details = { items: p.groups };
    } else if (d.ratemix) {
      const r = d.ratemix;
      // Entering/exiting/unattributed effects only exist as facts when such segments do: a 0 with no inputs would cite nothing.
      const calcs = [
        r.mix,
        r.rate,
        ...(r.enteringKeys.length ? [r.entering] : []),
        ...(r.exitingKeys.length ? [r.exiting] : []),
        ...(r.unattributedKeys.length ? [r.unattributed] : []),
      ];
      const scope = await book.calcs(calcs, context);
      for (const c of calcs) facts[c.name.replace("ratemix:", "")] = factOf(scope, c.name);
      details = {
        simpson_risk: r.simpsonRisk,
        segments: r.segments,
        entering: r.enteringKeys,
        exiting: r.exitingKeys,
        unattributed: r.unattributedKeys,
      };
    }
    storedDecomp.push({ id, method: d.method, insight: insightId, dimension: d.dimension, facts, details });
  }

  // The top driver of each contribution split, so a member change that only restates it isn't explained twice.
  const drivers = new Map<Insight, Set<string>>();
  for (const d of decompositions) {
    const top = [...(d.contribution?.contribution?.contributors ?? [])].sort(
      (a, b) => Math.abs(b.share.value) - Math.abs(a.share.value),
    )[0];
    if (top) drivers.set(d.insight, new Set([...(drivers.get(d.insight) ?? []), `${d.dimension}=${top.key}`]));
  }
  const explain = topForExplain(ranked, 7, { drivers, objective, slices: sliceParents(defs) }).flatMap((r) => {
    const id = idOf.get(r.insight);
    return id ? [{ id, score: r.score }] : [];
  });
  const top = explain.map((e) => e.id);
  const topScores = explain.map((e) => e.score);
  const result: AnalysisResult = {
    facts: book.facts,
    insights: stored,
    decompositions: storedDecomp,
    top,
    topScores,
    openQuestions: [...new Set(openQuestions)],
  };
  await persist(ws, result);
  return result;
}

/** The pack's `gross_margin`: split by member and by margin PVM like an additive metric. */
const isGrossMargin = (def: MetricDef | undefined, defs: readonly MetricDef[]): boolean =>
  def !== undefined && def.id === MARGIN_METRIC && marginTerms(def, defs)?.fn === MARGIN_METRIC;

const sumAbs = (pts: readonly { value: number }[]) => pts.reduce((a, p) => a + Math.abs(p.value), 0);
const periodOf = (r: Insight["roles"][string] | undefined) => (r?.kind === "point" ? r.period : undefined);

async function persist(ws: Workspace, r: AnalysisResult): Promise<void> {
  await persistFacts(ws, r.facts);
  for (const i of r.insights) {
    await ws.run(
      sql`INSERT INTO insights VALUES (${i.id}, ${i.template}, ${i.metric}, ${i.period}, ${JSON.stringify(i)}::JSON, ${JSON.stringify(Object.values(i.facts))}::VARCHAR[])`,
    );
  }
  for (const d of r.decompositions) {
    await ws.run(
      sql`INSERT INTO decompositions VALUES (${d.id}, ${d.method}, ${d.insight}, ${JSON.stringify(d)}::JSON, ${JSON.stringify(Object.values(d.facts))}::VARCHAR[])`,
    );
  }
}

/** Appends facts to the workspace `facts` table (the analysis, then any facts the agent's tools add). */
export async function persistFacts(ws: Workspace, facts: readonly Fact[]): Promise<void> {
  for (const f of facts) {
    const c = f.computation;
    await ws.run(sql`INSERT INTO facts (id, label, value, unit, currency, metric_id, kind, sql, params, fn, inputs, input_rows, definition_id)
      VALUES (${f.id}, ${f.label}, ${f.value}, ${f.unit}, ${f.currency ?? null}, ${f.metric_id ?? null}, ${c.kind}, ${c.sql ?? null},
        ${c.params ? JSON.stringify(c.params) : null}::JSON, ${c.fn ?? null}, ${JSON.stringify(c.inputs ?? [])}::VARCHAR[], ${JSON.stringify(f.citations)}::JSON, ${f.metric_id ?? null})`);
  }
}
