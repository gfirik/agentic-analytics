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
 * represented by its highest-priority template among those that carry at least half of the group's best score,
 * and scored by that best score. (A weak higher-priority template — June's small anomaly next to the rate shift
 * that makes the group material — must not speak for it.) The rest stay as supporting insights in the workspace.
 */
/** A group's representative must carry at least this share of the group's best score. */
export const REPRESENTATIVE_SHARE = 0.5;
/** A member change competes for the member slot when its impact share (see impactShare) is at least this. */
export const MEMBER_MIN_SHARE = 0.02;

/**
 * The insight's relative change (its `change_pct` calc, in percent), or 0 when it has none: no positive base (a loss
 * shrinking, a count from 0) ties at 0 in the member and rate slots, rather than ranking on a % that isn't stated.
 */
function relativeChange(r: Ranked): number {
  return r.insight.calcs.find((c) => c.name === "change_pct")?.value ?? 0;
}

export interface TopOptions {
  /**
   * Per insight, the members its decompositions name as the top driver (`dimension=value`). A member change that is
   * already the driver of a whole-metric change chosen above it restates that story and doesn't take the member slot.
   */
  readonly drivers?: ReadonlyMap<Insight, ReadonlySet<string>>;
  /** The objective metric (e.g. revenue): its family leads when it moved materially (see the lead order). */
  readonly objective?: string;
}

export function topForExplain(ranked: readonly Ranked[], max = 7, o: TopOptions = {}): Ranked[] {
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
      const best = Math.max(...g.map((x) => x.score));
      // A template with no measured change (a trend: slope and p-value, no Δ) scores 0 but is not weak; it keeps its
      // priority. Without this the Nov peak of Online Retail II was spoken for by a few small countries' new_lost
      // (real-data eval, M13a × M13e).
      const strong = g.filter((x) => x.score >= REPRESENTATIVE_SHARE * best || insightChange(x.insight) === undefined);
      const rep = [...strong].sort((a, b) => priority(a.insight.template) - priority(b.insight.template))[0] as Ranked;
      // The group carries its best score and its largest impact share: the member slot's floor applies to the event,
      // not to whichever template happens to speak for it.
      return { ...rep, score: best, impactShare: Math.max(...g.map((x) => x.impactShare)) };
    })
    // On a tie, the earlier period first: two groups of one series that score the same are the onset of a change
    // and a later restatement of it, and the onset is the finding (eval suite, M13a).
    .sort(
      (a, b) => b.score - a.score || a.insight.period.localeCompare(b.insight.period) || a.insight.series.localeCompare(b.insight.series),
    );
  // One slot per metric family first: the best whole-metric change of each family (a channel slice such as
  // `wholesale_revenue` belongs to `revenue`), in score order, then everything else in score order. A rate's
  // materiality is a small share of its own total, so without this a refund rate tripling loses every slot to
  // restatements of one revenue drop (spec §6; found by the eval suite in M11). EXPLAIN keeps this order.
  const metrics = [...new Set(reps.map((r) => r.insight.metric))];
  // Each family's slot goes to its parent metric's best change when that carries at least REPRESENTATIVE_SHARE of
  // the family's best score: the parent is the headline (and its decomposition names the driver), a channel slice
  // only restates it. Families keep the order of their best score.
  const families = new Map<string, Ranked[]>();
  for (const r of reps.filter((x) => !x.insight.member)) {
    const f = metricFamily(r.insight.metric, metrics);
    families.set(f, [...(families.get(f) ?? []), r]);
  }
  const firsts = [...families.entries()].map(([family, rs]) => {
    const best = rs[0] as Ranked;
    const parent = rs.find((r) => r.insight.metric === family);
    return parent && parent.score >= REPRESENTATIVE_SHARE * best.score ? parent : best;
  });
  // Then one slot for the most dramatic change of a single member (a product, a customer); without it such a story
  // always ranks below the whole-metric restatements (eval suite, M13a). The members the chosen changes' decompositions
  // already name as their driver are told.
  const groupOf = (r: Ranked) => groups.get(`${r.insight.series}@${r.insight.period}`) ?? [r];
  const told = new Set(firsts.flatMap((f) => groupOf(f).flatMap((x) => [...(o.drivers?.get(x.insight) ?? [])])));

  // The lead order (M14a). Small-model mode explains only three findings, and with a real model drafting 8–15 metrics
  // the other families (gross margin, net profit, a second sales measure, a channel share, order counts) each restated
  // the lead change and took the second and third slots, so the planted rate and member events were never explained
  // (nightly run 2026-10-19: P2 found in 3 of 7 finished jobs, P3 in 0 of 7). The order is now: the lead; the most
  // dramatic rate change; the member story; then the other families, other events before restatements.
  //
  // The lead is the objective's own change when it carries at least REPRESENTATIVE_SHARE of the best family's score:
  // gross margin or net profit often scores a little higher on the same event, but the report is about revenue.
  const objectiveFamily = o.objective === undefined ? undefined : metricFamily(o.objective, metrics);
  const best = firsts[0];
  const own = firsts.find((r) => metricFamily(r.insight.metric, metrics) === objectiveFamily);
  const primary = own && best && own.score >= REPRESENTATIVE_SHARE * best.score ? own : best;
  // A change in the lead's period, in any metric and either direction, is usually the lead event seen through another
  // measure (margin falls with revenue; the other channel's share rises); a change in another period is another event.
  const restates = (r: Ranked) => primary !== undefined && r.insight.period === primary.insight.period;
  const otherEventsFirst = (a: Ranked, b: Ranked) => Number(restates(a)) - Number(restates(b));
  // The member story: the largest relative change among members that matter (impact share ≥ MEMBER_MIN_SHARE: |Δ| over
  // the objective's period total), another event before a restatement. A product cannibalized by a launch falls by
  // most of its value; a member that only restates a whole-metric drop falls by that drop's share. A member that is
  // already the driver of a whole-metric change chosen above it (told) restates that story and isn't a candidate.
  const pick = reps
    .filter(
      (r) =>
        r.insight.member &&
        !firsts.includes(r) &&
        r.impactShare >= MEMBER_MIN_SHARE &&
        !told.has(`${r.insight.member.dimension}=${r.insight.member.value}`),
    )
    .sort((a, b) => otherEventsFirst(a, b) || Math.abs(relativeChange(b)) - Math.abs(relativeChange(a)) || b.score - a.score)[0];
  // A member change on a slice (a channel's revenue) speaks through the objective's or its parent metric's change for
  // the same member and period, as a family's slot does: "Flyers A5 revenue fell", not "walk-in revenue for Flyers A5
  // fell". Drafted slice names often don't share the parent's id (`revenue_by_channel_walkin` next to `total_revenue`),
  // so the objective counts as a parent too (the 2026-10-20 nightly drafts, replayed).
  const parentOf = (r: Ranked) =>
    reps.find(
      (x) =>
        (x.insight.metric === o.objective || x.insight.metric === metricFamily(r.insight.metric, metrics)) &&
        x.insight.metric !== r.insight.metric &&
        x.insight.period === r.insight.period &&
        x.insight.member?.dimension === r.insight.member?.dimension &&
        x.insight.member?.value === r.insight.member?.value &&
        x.score >= REPRESENTATIVE_SHARE * r.score,
    );
  const member = pick && (parentOf(pick) ?? pick);
  // The rate story: a percent-unit family (a refund rate tripling is a few points, so on score it trails every money
  // restatement), the largest relative change first, another event before a restatement.
  const rest = firsts.filter((r) => r !== primary);
  const rate = rest
    .filter((r) => insightChange(r.insight)?.unit === "percent")
    .sort((a, b) => otherEventsFirst(a, b) || Math.abs(relativeChange(b)) - Math.abs(relativeChange(a)) || b.score - a.score)[0];
  // A family first with no measured change (a count, a trend) scores 0: material families come before it, whatever
  // the period, so normal mode's slots 4–7 aren't spent on them.
  const others = [...rest]
    .sort((a, b) => Number(a.score === 0) - Number(b.score === 0) || otherEventsFirst(a, b))
    .filter((r) => r !== rate);
  const lead = [...(primary ? [primary] : []), ...(rate ? [rate] : []), ...(member ? [member] : []), ...others];
  return [...lead, ...reps.filter((r) => !lead.includes(r))].slice(0, max);
}

/**
 * The family a metric belongs to: the other metric it is a slice of (`wholesale_revenue` → `revenue`), else itself.
 * A slice id is `<prefix>_<parent>` with a non-empty prefix, as the metric drafts name channel slices.
 */
export function metricFamily(metric: string, metrics: readonly string[]): string {
  return metrics.find((x) => x !== metric && metric.length > x.length + 1 && metric.endsWith(`_${x}`)) ?? metric;
}
