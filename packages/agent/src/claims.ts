// Deterministic claims: the observed change and its decomposition are stated by code, not by the model, so the
// numbers in them are always the right facts (agent-and-verifier §5, grade `observed`). Names that come from the
// data (customers, products) are put in quotation marks: they are data, and their digits ("1kg") are not
// numerals the report asserts (report-schema §3).
import type { StoredDecomposition, StoredInsight } from "@agentic-analytics/analysis";
import type { Claim, Fact, Finding, MetricDef } from "@agentic-analytics/schema";

/** Data text inside quotation marks; curly quotes inside are flattened so the quoting stays balanced. */
export const q = (s: string | null | undefined): string => `“${String(s ?? "(none)").replace(/[“”"]/g, "'")}”`;

/** A label as prose, quoted when it carries digits that must not read as free numerals. */
export const label = (s: string): string => (/\d/.test(s) ? q(s) : s);

const PERIOD = /_(\d{4}(?:-\d{2}){0,2}|\d{4}-[QW]\d{1,2})$/;
/** The period a measured fact is for ("revenue_2026-03" → "2026-03"). */
export const periodOf = (f: Fact | undefined): string | undefined => (f ? PERIOD.exec(f.label)?.[1] : undefined);

const ph = (id: string | undefined): string => (id ? `{{${id}}}` : "");

export function observedClaim(i: StoredInsight, defs: readonly MetricDef[], facts: ReadonlyMap<string, Fact>): Claim | undefined {
  const def = defs.find((d) => d.id === i.metric);
  const m = `${label(def?.label ?? i.metric)}${i.member ? ` for ${q(i.member.value)}` : ""}`;
  const f = i.facts;
  const make = (text: string, ids: (string | undefined)[]): Claim => ({
    text,
    facts: ids.filter((x): x is string => x !== undefined),
    citations: [],
    causal_grade: "observed",
    verified: false,
  });
  if (f.before && f.after && f.change) {
    const p0 = periodOf(facts.get(f.before)) ?? "the baseline";
    const p1 = periodOf(facts.get(f.after)) ?? i.period;
    const pct = f.change_pct ? `, ${ph(f.change_pct)}` : "";
    let text = `${m} went from ${ph(f.before)} in ${p0} to ${ph(f.after)} in ${p1} (a change of ${ph(f.change)}${pct}).`;
    const ids = [f.before, f.after, f.change, f.change_pct];
    if (f.latest && f.change_since && f.latest !== f.after) {
      text += ` It stood at ${ph(f.latest)} in ${periodOf(facts.get(f.latest)) ?? "the latest period"}.`;
      ids.push(f.latest);
    }
    return make(text, ids);
  }
  if (i.template === "concentration.v1" && f.top_share)
    return make(`${q(String(i.details.top))} made up ${ph(f.top_share)} of ${m} in ${i.period}.`, [f.top_share]);
  if (i.template === "new_lost.v1") {
    const lost = (i.details.lost as (string | null)[] | undefined) ?? [];
    const gained = (i.details.new as (string | null)[] | undefined) ?? [];
    const parts: string[] = [];
    if (f.lost_value && lost.length)
      parts.push(
        `${lost.map(q).join(", ")} brought ${ph(f.lost_value)} of ${m} in ${String(i.details.baseline)} and nothing in ${i.period}`,
      );
    if (f.new_value && gained.length)
      parts.push(`${gained.map(q).join(", ")} brought ${ph(f.new_value)} of ${m} in ${i.period} and nothing before`);
    return parts.length ? make(`${parts.join("; ")}.`, [f.lost_value, f.new_value]) : undefined;
  }
  if (i.template === "mix_shift.v1" && f.share_shift_pp)
    return make(
      `The share of ${q(String(i.details.member))} in ${m} moved by ${ph(f.share_shift_pp)} percentage points from ${String(i.details.baseline)} to ${i.period}.`,
      [f.share_shift_pp],
    );
  if (i.template === "trend.v1" && f.slope) return make(`${m} shows a sustained trend of ${ph(f.slope)} per period.`, [f.slope]);
  return undefined;
}

export interface Driver {
  readonly label: string;
  readonly fact: string;
  readonly share_of_change: string;
}

/** Contribution members sorted by |share of change|, from the decomposition with the most concentrated driver. */
export function contributionDrivers(
  ds: readonly StoredDecomposition[],
  facts: ReadonlyMap<string, Fact>,
): { decomposition: StoredDecomposition; drivers: Driver[] } | undefined {
  let best: { decomposition: StoredDecomposition; drivers: Driver[]; top: number } | undefined;
  for (const d of ds.filter((x) => x.method === "contribution.v1")) {
    const drivers = driversOf(d, facts);
    // The split that explains the change best is the one whose top member carries the most of the movement
    // (|Δ top| / Σ|Δ|): shares over 100% from members offsetting each other (a launch up, the product it replaced
    // down) don't make a dimension explanatory (M13a).
    const total = drivers.reduce((a, x) => a + Math.abs(facts.get(x.fact)?.value ?? 0), 0);
    const top = total > 0 ? Math.abs(facts.get(drivers[0]?.fact ?? "")?.value ?? 0) / total : 0;
    if (drivers.length && (!best || top > best.top)) best = { decomposition: d, drivers, top };
  }
  return best ? { decomposition: best.decomposition, drivers: best.drivers } : undefined;
}

/** A contribution split's members, largest share of the change first. */
function driversOf(d: StoredDecomposition, facts: ReadonlyMap<string, Fact>): Driver[] {
  return Object.keys(d.facts)
    .filter((k) => k.startsWith("share:"))
    .map((k) => ({ label: k.slice("share:".length), fact: d.facts[`change:${k.slice(6)}`] ?? "", share_of_change: d.facts[k] ?? "" }))
    .filter((x) => x.fact && x.share_of_change)
    .sort((a, b) => Math.abs(facts.get(b.share_of_change)?.value ?? 0) - Math.abs(facts.get(a.share_of_change)?.value ?? 0));
}

/**
 * The top member of every contribution split (the best split's first, then the others', no repeats): a channel and a
 * customer often both name the change, and the document that explains it may name either.
 */
export function topDrivers(ds: readonly StoredDecomposition[], facts: ReadonlyMap<string, Fact>): string[] {
  const best = contributionDrivers(ds, facts)?.decomposition;
  const splits = ds.filter((x) => x.method === "contribution.v1").sort((a, b) => Number(b === best) - Number(a === best));
  // "(other)" is the remainder of a split, not a name a document would use.
  return [
    ...new Set(
      splits.flatMap((d) =>
        driversOf(d, facts)
          .filter((x) => x.label !== "(other)")
          .slice(0, 1)
          .map((x) => x.label),
      ),
    ),
  ];
}

/**
 * A top member that moved by more than the whole change (a share over 100%, members offsetting each other) reads
 * as an error when stated as a share ("wholesale accounted for 108% of the change"), so it is stated in magnitudes:
 * "wholesale fell 8,500, more than the whole drop; retail rose 600" (the drop itself is the sentence before). Only when
 * the decomposition recorded
 * the comparison as a fact (`exceeds:<member>` = 1, analysis-library §4.1); the claim cites it, and the verifier
 * recomputes it and refuses "more than the whole" without it.
 */
function beyondClaim(
  d: StoredDecomposition,
  member: string,
  facts: ReadonlyMap<string, Fact>,
): { text: string; facts: string[] } | undefined {
  const f = d.facts;
  const exceeds = f[`exceeds:${member}`];
  const size = f[`magnitude:${member}`];
  const total = facts.get(f.total ?? "")?.value;
  if (!exceeds || !size || facts.get(exceeds)?.value !== 1 || total === undefined || total === 0) return undefined;
  const down = total < 0;
  const offsetKey = Object.keys(f)
    .filter((k) => k.startsWith("magnitude:") && k !== `magnitude:${member}`)
    .map((k) => k.slice("magnitude:".length))[0];
  const offset = offsetKey === undefined ? undefined : f[`magnitude:${offsetKey}`];
  return {
    text: `By ${label(d.dimension)}, ${q(member)} ${down ? "fell" : "rose"} ${ph(size)}, more than the whole ${down ? "drop" : "rise"}${
      offset && offsetKey !== undefined ? `; ${q(offsetKey)} ${down ? "rose" : "fell"} ${ph(offset)}` : ""
    }.`,
    facts: [size, ...(offset ? [offset] : []), exceeds],
  };
}

export function decompositionClaims(ds: readonly StoredDecomposition[], facts: ReadonlyMap<string, Fact>): Claim[] {
  const out: Claim[] = [];
  const claim = (text: string, ids: (string | undefined)[]): Claim => ({
    text,
    facts: ids.filter((x): x is string => x !== undefined && x !== ""),
    citations: [],
    causal_grade: "observed",
    verified: false,
  });
  const c = contributionDrivers(ds, facts);
  const top = c?.drivers[0];
  const beyond = c && top ? beyondClaim(c.decomposition, top.label, facts) : undefined;
  if (c && top)
    out.push(
      beyond
        ? claim(beyond.text, beyond.facts)
        : claim(
            `By ${label(c.decomposition.dimension)}, ${q(top.label)} accounted for ${ph(top.share_of_change)} of the change (${ph(top.fact)}).`,
            [top.share_of_change, top.fact],
          ),
    );
  for (const d of ds) {
    const f = d.facts;
    if (d.method === "pvm.v1" && f.price && f.volume && f.mix) {
      const extra = [
        f.new ? `new items ${ph(f.new)}` : "",
        f.lost ? `lost items ${ph(f.lost)}` : "",
        f.unpriced ? `items without quantity ${ph(f.unpriced)}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      out.push(
        claim(
          `By ${label(d.dimension)}, the price effect was ${ph(f.price)}, the volume effect ${ph(f.volume)} and the mix effect ${ph(f.mix)}${extra ? `; ${extra}` : ""}.`,
          [f.price, f.volume, f.mix, f.new, f.lost, f.unpriced],
        ),
      );
    }
    if (d.method === "ratemix.v1" && f.mix && f.rate) {
      const simpson =
        d.details.simpson_risk === true
          ? " Most segments moved the other way than the total, so the segment story matters more than the total."
          : "";
      out.push(
        claim(`By ${label(d.dimension)}, the mix effect was ${ph(f.mix)} and the rate effect ${ph(f.rate)}.${simpson}`, [f.mix, f.rate]),
      );
    }
  }
  return out;
}

/** Metrics where an increase is bad news (refunds, churn, costs); everything else: up is an improvement. */
export const LOWER_IS_BETTER = /refund|return|churn|cost|expense|defect|complaint|cancel|discount|возврат|отток|расход|qaytar|xarajat/i;

export function findingType(i: StoredInsight, def: MetricDef | undefined): Finding["type"] {
  if (i.template === "trend_break.v1") return "trend_break";
  if (i.template === "anomaly.v1") return "anomaly";
  if (i.template === "concentration.v1") return "concentration_risk";
  if (i.template === "benchmark_gap.v1") return "benchmark_gap";
  const worse = LOWER_IS_BETTER.test(`${i.metric} ${def?.label ?? ""}`) ? i.direction === "up" : i.direction === "down";
  return worse ? "regression" : "improvement";
}

/** Severity from the ranking score (impact share × confidence × recency, analysis-library §6). */
export function severity(score: number): Finding["severity"] {
  return score >= 0.03 ? "high" : score >= 0.005 ? "medium" : "low";
}
