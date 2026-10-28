// The verifier's checks on the report sections code builds (agent-and-verifier §7, analysis-library §12–§13):
// - V2 recomputes the scorecard's `material` flag with baselines.ts `materiality()` from the row's change, change %, band
//   and mean facts; a different flag is a mismatch, an engine bug like any other V2 mismatch.
// - V1 holds "Analyses not run" to the rule of every report text: its reason carries no number, so an entry with a free
//   numeral (or a placeholder) is dropped and listed.
import { materiality } from "@agentic-analytics/analysis";
import { type Fact, findFreeNumerals, type NotRun, placeholders, type Report } from "@agentic-analytics/schema";

export interface MaterialCheck {
  readonly metric: string;
  readonly stored: boolean | null;
  readonly computed: boolean | null;
  readonly ok: boolean;
  readonly how: string;
}

/** The scorecard's flags as V2 recomputes them: `null` without a band or a baseline change (§12). */
export function recheckMaterial(scorecard: Report["scorecard"], facts: ReadonlyMap<string, Fact>): MaterialCheck[] {
  const value = (id: string | undefined) => (id === undefined ? Number.NaN : (facts.get(id)?.value ?? Number.NaN));
  return (scorecard?.rows ?? []).map((r) => {
    const band = r.materiality_inputs?.band;
    let computed: boolean | null = null;
    if (!("na" in r.vs_base) && band !== undefined && r.materiality_inputs)
      computed = materiality(value(r.vs_base.change), value(r.vs_base.change_pct), value(band), value(r.materiality_inputs.mean)).material;
    return {
      metric: r.metric_id,
      stored: r.material,
      computed,
      ok: computed === r.material,
      how: "materiality() of the baseline change, change %, band and mean",
    };
  });
}

/** V1 on the not-run reasons: the entries that keep their wording, and those dropped with why. */
export function checkNotRun(
  entries: readonly NotRun[],
  years: ReadonlySet<string>,
): { readonly kept: NotRun[]; readonly dropped: { readonly claim: string; readonly reason: string }[] } {
  const kept: NotRun[] = [];
  const dropped: { claim: string; reason: string }[] = [];
  for (const n of entries) {
    const free = [...findFreeNumerals(n.reason, years), ...placeholders(n.reason).map((p) => `{{${p}}}`)];
    if (free.length)
      dropped.push({ claim: n.reason, reason: `V1: the reason of not-run ${n.analysis} carries a number (${free.join(", ")})` });
    else kept.push(n);
  }
  return { kept, dropped };
}
