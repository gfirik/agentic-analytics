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

/** The findings that go to EXPLAIN: the top 7 by score, and at least 3 when there are that many. */
export function topForExplain(ranked: readonly Ranked[], max = 7): Ranked[] {
  return ranked.slice(0, max);
}
