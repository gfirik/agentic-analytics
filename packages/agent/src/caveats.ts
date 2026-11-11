// One-line caveats the engine states by itself (backtest pre-tag 5; report-schema §3, analysis-library §2): amounts
// are nominal, and a December change against November is probably the season. Both are report assumptions linked to
// the findings they qualify, so they reach the reader (the metric layer's validation notes never do). They are decided
// from the CODE-built claims of a finding (`observedClaim`, `decompositionClaims`), never from the model's claims
// (a model claim can cite any fact and be graded observed). Text carries no numerals: the periods are read from the
// facts of the claim, never written into the caveat.
import type { StoredDecomposition, StoredInsight } from "@agentic-analytics/analysis";
import type { Assumption, AssumptionCaveat, Claim, Fact, Finding, MetricDef } from "@agentic-analytics/schema";
import { decompositionClaims, observedClaim, periodOf } from "./claims.ts";

export const NOMINAL_TEXT = "Amounts are nominal, as in the files; they are not adjusted for inflation.";
export const DECEMBER_TEXT = "December is often a seasonal peak; compare it with December of last year.";

/** The two periods a claim compares: its first two facts are the baseline and the new value (claims.ts). */
function comparedPeriods(c: Claim, facts: ReadonlyMap<string, Fact>): { from: string; to: string } | undefined {
  const a = facts.get(c.facts[0] ?? "");
  const b = facts.get(c.facts[1] ?? "");
  const from = periodOf(a);
  const to = periodOf(b);
  if (!a || !b || !from || !to || from === to || a.metric_id !== b.metric_id || a.unit !== b.unit) return undefined;
  return { from, to };
}

/** A claim states a change over time (before and after, a change amount, a trend slope, a new or lost value): citing money, amounts are compared across periods. */
const comparesMoney = (c: Claim, facts: ReadonlyMap<string, Fact>): boolean => c.facts.some((id) => facts.get(id)?.unit === "currency");

/** A month label ("2023-12") as a count of months, so consecutive months differ by one across a year end. */
function monthIndex(period: string): number | undefined {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  return m ? Number(m[1]) * 12 + Number(m[2]) : undefined;
}

/** True for a month-grain comparison of consecutive months whose later month is December. */
export function isDecemberStep(from: string, to: string): boolean {
  const a = monthIndex(from);
  const b = monthIndex(to);
  return a !== undefined && b !== undefined && b - a === 1 && to.endsWith("-12");
}

/** True when the claim compares consecutive months at month grain and December is the later one. */
export function statesDecemberStep(c: Claim, facts: ReadonlyMap<string, Fact>): boolean {
  const p = comparedPeriods(c, facts);
  return p !== undefined && isDecemberStep(p.from, p.to);
}

/**
 * The caveat assumptions for a draft, numbered from `firstId`: at most one nominal-amounts assumption (when a finding's
 * code-built claims cite money) and one December assumption, each affecting the findings it applies to.
 * `codeClaims` maps a finding id to the claims code built for it.
 */
export function caveatAssumptions(
  findings: readonly Finding[],
  codeClaims: ReadonlyMap<string, readonly Claim[]>,
  facts: ReadonlyMap<string, Fact>,
  firstId: number,
): Assumption[] {
  const out: Assumption[] = [];
  const add = (caveat: AssumptionCaveat, text: string, applies: (c: Claim) => boolean) => {
    const affects = findings.filter((f) => (codeClaims.get(f.id) ?? []).some(applies)).map((f) => f.id);
    if (affects.length) out.push({ id: `A${firstId + out.length}`, text, affects, caveat });
  };
  add("nominal", NOMINAL_TEXT, (c) => comparesMoney(c, facts));
  add("seasonal", DECEMBER_TEXT, (c) => statesDecemberStep(c, facts));
  return out;
}

/** The claims code built for each finding (the same ones EXPLAIN starts a finding with), by finding id. */
export function codeClaimsOf(
  insightOf: Readonly<Record<string, string>>,
  insights: readonly StoredInsight[],
  decompositions: readonly StoredDecomposition[],
  defs: readonly MetricDef[],
  facts: ReadonlyMap<string, Fact>,
): Map<string, Claim[]> {
  const out = new Map<string, Claim[]>();
  for (const [finding, id] of Object.entries(insightOf)) {
    const insight = insights.find((i) => i.id === id);
    if (!insight) continue;
    const ds = decompositions.filter((d) => d.insight === id);
    out.set(
      finding,
      [observedClaim(insight, defs, facts), ...decompositionClaims(ds, facts)].filter((c): c is Claim => c !== undefined),
    );
  }
  return out;
}
