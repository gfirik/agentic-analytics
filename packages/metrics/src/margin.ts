// The margin metrics' fixed shape (docs/specs/analysis-library.md §9), read by the pack that drafts them, the fact book
// that records their values as function facts, and the verifier. Nothing here computes a number.
import type { MetricDef } from "@agentic-analytics/schema";

export const COST_METRIC = "cost";
export const COSTED_REVENUE_METRIC = "costed_revenue";
export const MARGIN_METRIC = "gross_margin";
export const MARGIN_PCT_METRIC = "gross_margin_pct";

/** The function ids of a margin fact: `gross_margin` = a − b and `gross_margin_pct` = (a − b) ÷ a × 100 over [revenue, cost]. */
export type MarginFn = typeof MARGIN_METRIC | typeof MARGIN_PCT_METRIC;

export interface MarginTerms {
  readonly fn: MarginFn;
  /** The metric measuring revenue (`revenue`, or `costed_revenue` when some lines have no cost) and the cost metric. */
  readonly revenue: string;
  readonly cost: string;
}

const MINUS = /^\s*([a-z][a-z0-9_]*)\s*-\s*([a-z][a-z0-9_]*)\s*$/;

/**
 * The two metrics a margin definition is built from, or undefined when `def` is not the pack's margin shape:
 * `gross_margin` is a derived `<revenue> - <cost>`; `gross_margin_pct` is a ratio of `gross_margin` over that revenue.
 */
export function marginTerms(def: MetricDef, defs: readonly MetricDef[]): MarginTerms | undefined {
  if (def.id === MARGIN_METRIC && def.type === "derived") {
    const m = MINUS.exec(def.expression ?? "");
    return m?.[1] && m[2] ? { fn: MARGIN_METRIC, revenue: m[1], cost: m[2] } : undefined;
  }
  if (def.id === MARGIN_PCT_METRIC && def.type === "ratio" && def.unit === "percent") {
    const num = def.numerator;
    const den = def.denominator;
    const margin = defs.find((d) => d.id === MARGIN_METRIC);
    const base = margin ? marginTerms(margin, defs) : undefined;
    if (base && num && "metric" in num && num.metric === MARGIN_METRIC && den && "metric" in den && den.metric === base.revenue)
      return { fn: MARGIN_PCT_METRIC, revenue: base.revenue, cost: base.cost };
  }
  return undefined;
}

/** The value a margin function gives for its inputs; NaN when it is undefined (a percentage over revenue ≤ 0, §9). */
export function marginValue(fn: MarginFn, revenue: number, cost: number): number {
  if (fn === MARGIN_METRIC) return revenue - cost;
  return revenue > 0 ? ((revenue - cost) / revenue) * 100 : Number.NaN;
}
