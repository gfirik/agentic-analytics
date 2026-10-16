// Ranking findings (docs/specs/analysis-library.md §6): materiality = |impact on the objective metric as a
// share of its period total| × confidence weight × recency weight. The top 3–7 go to EXPLAIN.
import type { Insight } from "./templates.ts";
import type { Confidence } from "./types.ts";

export const CONFIDENCE_WEIGHT: Record<Confidence, number> = { high: 1, medium: 0.6, low: 0.3 };
export const RECENCY_DECAY = 0.8;

export interface RankContext {
  /** The objective metric (e.g. revenue) and its total per period. */
  readonly objectiveMetric: string;
  readonly objectiveTotals: ReadonlyMap<string, number>;
  /** All periods in order; recency counts back from the last. */
  readonly periods: readonly string[];
  /** |change| of an insight in its own unit, and its unit. */
  readonly changeOf: (i: Insight) => { readonly value: number; readonly unit: string } | undefined;
}

/**
 * The change an insight is ranked by: for a break, the shift that persists to the latest period
 * (`change_since`), else its change, else the value of lost members. Used by the runner and its tests alike.
 */
export function insightChange(i: Insight): { readonly value: number; readonly unit: string } | undefined {
  const name = i.roles.change_since ? "change_since" : i.roles.change ? "change" : i.roles.lost_value ? "lost_value" : undefined;
  const c = name ? i.calcs.find((x) => x.name === name) : undefined;
  return c ? { value: c.value, unit: c.unit } : undefined;
}

export interface Ranked {
  readonly insight: Insight;
  readonly impactShare: number;
  readonly score: number;
}

/**
 * Impact on the objective as a share of its period total. Money changes divide by the objective's total for
 * the period; rate changes in percentage points are already a share of the base (2.2 pp → 0.022); other
 * metrics fall back to their relative change.
 */
export function impactShare(i: Insight, ctx: RankContext): number {
  const change = ctx.changeOf(i);
  if (!change || !Number.isFinite(change.value)) return 0;
  if (change.unit === "currency") {
    const total = ctx.objectiveTotals.get(i.period);
    return total ? Math.abs(change.value) / Math.abs(total) : 0;
  }
  if (change.unit === "percent") return Math.abs(change.value) / 100;
  return 0;
}

export function rankInsights(insights: readonly Insight[], ctx: RankContext): Ranked[] {
  const last = ctx.periods.length - 1;
  return insights
    .filter((i) => i.material)
    .map((insight) => {
      const share = impactShare(insight, ctx);
      const back = Math.max(0, last - ctx.periods.indexOf(insight.period));
      return { insight, impactShare: share, score: share * CONFIDENCE_WEIGHT[insight.confidence] * RECENCY_DECAY ** back };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.insight.series.localeCompare(b.insight.series) || a.insight.template.localeCompare(b.insight.template),
    );
}

/** Which template speaks for an event when several detect it (same series, same period). */
export const TEMPLATE_PRIORITY: readonly string[] = [
  "trend_break.v1",
  "anomaly.v1",
  "period_change.v1",
  "ratio_shift.v1",
  "trend.v1",
  "new_lost.v1",
  "mix_shift.v1",
  "concentration.v1",
  "top_contributors.v1",
  "benchmark_gap.v1",
];

/**
 * The findings that go to EXPLAIN (spec §6: top 3–7). Several templates often detect one event (April's drop is
 * a trend break, an anomaly and a lost customer), so insights are grouped by series and period; each group is
 * represented by its highest-priority template and scored by its best score. The rest stay as supporting
 * insights in the workspace.
 */
export function topForExplain(ranked: readonly Ranked[], max = 7): Ranked[] {
  const groups = new Map<string, Ranked[]>();
  for (const r of ranked) {
    const key = `${r.insight.series}@${r.insight.period}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const priority = (t: string) => {
    const i = TEMPLATE_PRIORITY.indexOf(t);
    return i < 0 ? TEMPLATE_PRIORITY.length : i;
  };
  const reps = [...groups.values()]
    .map((g) => {
      const rep = [...g].sort((a, b) => priority(a.insight.template) - priority(b.insight.template))[0] as Ranked;
      return { ...rep, score: Math.max(...g.map((x) => x.score)) };
    })
    .sort((a, b) => b.score - a.score || a.insight.series.localeCompare(b.insight.series));
  // One slot per metric family first: the best whole-metric change of each family (a channel slice such as
  // `wholesale_revenue` belongs to `revenue`) before any second change of a family. A rate's materiality is a
  // small share of its own total, so without this a refund rate tripling loses every slot to restatements of one
  // revenue drop (spec §6; found by the eval suite in M11).
  const metrics = new Set(reps.map((r) => r.insight.metric));
  const family = (m: string) => [...metrics].find((x) => x !== m && m.endsWith(`_${x}`)) ?? m;
  const seen = new Set<string>();
  const firsts = reps.filter((r) => !r.insight.member && !seen.has(family(r.insight.metric)) && seen.add(family(r.insight.metric)));
  const chosen = new Set([...firsts.slice(0, max), ...reps.filter((r) => !firsts.includes(r))].slice(0, max));
  return reps.filter((r) => chosen.has(r));
}
