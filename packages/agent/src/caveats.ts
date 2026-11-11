// One-line caveats the engine states by itself (backtest pre-tag 5; report-schema §3, agent-and-verifier §5): amounts
// are nominal, and a December change against November is probably the season. Both are report assumptions linked to
// the findings they qualify, so they reach the reader (the metric layer's validation notes never do). Text carries no
// numerals: the periods are read from the facts of the observed claim, never written into the caveat.
import type { Assumption, AssumptionCaveat, Fact, Finding } from "@agentic-analytics/schema";
import { periodOf } from "./claims.ts";

export const NOMINAL_TEXT = "Amounts are nominal, as in the files; they are not adjusted for inflation.";
export const DECEMBER_TEXT = "December is often a seasonal peak; compare it with December of last year.";

/** The two periods an observed claim compares: its first two facts are the baseline and the new value (claims.ts). */
function comparedPeriods(finding: Finding, facts: ReadonlyMap<string, Fact>): { from: string; to: string }[] {
  return finding.claims.flatMap((c) => {
    if (c.causal_grade !== "observed") return [];
    const a = facts.get(c.facts[0] ?? "");
    const b = facts.get(c.facts[1] ?? "");
    const from = periodOf(a);
    const to = periodOf(b);
    if (!a || !b || !from || !to || from === to || a.metric_id !== b.metric_id || a.unit !== b.unit) return [];
    return [{ from, to }];
  });
}

/**
 * An observed claim states a change over time (before and after, a change amount, a trend slope, a new or lost
 * member's value): when it cites a money fact, amounts are being compared across periods.
 */
function comparesMoney(finding: Finding, facts: ReadonlyMap<string, Fact>): boolean {
  return finding.claims.some((c) => c.causal_grade === "observed" && c.facts.some((id) => facts.get(id)?.unit === "currency"));
}

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

/**
 * The caveat assumptions for a draft, numbered from `firstId`: at most one nominal-amounts assumption (when a money
 * metric is compared across periods) and one December assumption, each affecting the findings it applies to.
 */
export function caveatAssumptions(findings: readonly Finding[], facts: ReadonlyMap<string, Fact>, firstId: number): Assumption[] {
  const compared = findings.map((f) => ({ id: f.id, steps: comparedPeriods(f, facts) }));
  const out: Assumption[] = [];
  const add = (caveat: AssumptionCaveat, text: string, affects: string[]) => {
    if (affects.length) out.push({ id: `A${firstId + out.length}`, text, affects, caveat });
  };
  add(
    "nominal",
    NOMINAL_TEXT,
    findings.filter((f) => comparesMoney(f, facts)).map((f) => f.id),
  );
  add(
    "seasonal",
    DECEMBER_TEXT,
    compared.filter((c) => c.steps.some((s) => isDecemberStep(s.from, s.to))).map((c) => c.id),
  );
  return out;
}
