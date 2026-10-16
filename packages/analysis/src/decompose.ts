// Decomposers (docs/specs/analysis-library.md §4). Pure functions that split a change into drivers and
// return every number as a `Calc` with its inputs, so the runner can record each as a fact.
import { type Calc, calcRef, point, type Ref, type Unit } from "./types.ts";

// ── 4.1 Additive contribution (contribution.v1) ─────────────────────────────────────────────────────────────

export interface MemberChange {
  readonly key: string; // member label, e.g. "wholesale"
  readonly series: string; // series id of the member
  readonly before: { readonly period: string; readonly value: number };
  readonly after: { readonly period: string; readonly value: number };
}

export interface Contribution {
  readonly method: "contribution.v1";
  readonly totalDelta: Calc;
  readonly contributors: readonly { readonly key: string; readonly delta: Calc; readonly share: Calc }[];
  /** Keys of members that moved with / against the total. */
  readonly positive: readonly string[];
  readonly negative: readonly string[];
}

/**
 * For T = Σ xᵢ: ΔT = Σ Δxᵢ and shareᵢ = Δxᵢ / ΔT (spec §4.1). Shares can exceed 100% when contributors
 * offset each other (wholesale −8,500 and retail +600 → total −7,900 → wholesale 108%). Positive and negative
 * contributors are reported separately. Shares are percent (×100).
 */
export function contribution(members: readonly MemberChange[], unit: Unit): Contribution {
  const deltas = members.map((m) => ({
    key: m.key,
    delta: {
      name: `delta:${m.key}`,
      label: `change in ${m.key}`,
      value: m.after.value - m.before.value,
      unit,
      fn: "delta",
      inputs: [point(m.series, m.after.period), point(m.series, m.before.period)],
    } satisfies Calc,
  }));
  const total = deltas.reduce((s, d) => s + d.delta.value, 0);
  const totalDelta: Calc = {
    name: "delta:total",
    label: "total change",
    value: total,
    unit,
    fn: "sum",
    inputs: deltas.map((d) => calcRef(d.delta.name)),
  };
  const contributors = deltas
    .map((d) => ({
      key: d.key,
      delta: d.delta,
      share: {
        name: `share:${d.key}`,
        label: `${d.key} share of the change`,
        value: total !== 0 ? (d.delta.value / total) * 100 : Number.NaN,
        unit: "percent" as const,
        fn: "contribution.v1",
        inputs: [calcRef(d.delta.name), calcRef(totalDelta.name)],
      },
    }))
    .sort((a, b) => Math.abs(b.delta.value) - Math.abs(a.delta.value) || a.key.localeCompare(b.key));
  return {
    method: "contribution.v1",
    totalDelta,
    contributors,
    positive: contributors.filter((c) => Math.sign(c.delta.value) === Math.sign(total) && c.delta.value !== 0).map((c) => c.key),
    negative: contributors.filter((c) => Math.sign(c.delta.value) !== Math.sign(total) && c.delta.value !== 0).map((c) => c.key),
  };
}

// ── 4.2 Price–volume–mix (pvm.v1) ───────────────────────────────────────────────────────────────────────────

export interface PvmItem {
  readonly key: string;
  /** Revenue and quantity per period; absent when the item didn't sell in that period. */
  readonly r0?: number;
  readonly q0?: number;
  readonly r1?: number;
  readonly q1?: number;
  /** Refs of the measured revenue/quantity points, for provenance. */
  readonly refs: { readonly r0?: Ref; readonly q0?: Ref; readonly r1?: Ref; readonly q1?: Ref };
}

export interface Pvm {
  readonly method: "pvm.v1";
  readonly volume: Calc;
  readonly mix: Calc;
  readonly price: Calc;
  readonly newItems: Calc;
  readonly lostItems: Calc;
  readonly total: Calc;
}

/**
 * For items present in both periods (spec §4.2): Q = Σqᵢ, sᵢ = qᵢ/Q, P̄₀ = Σ sᵢ₀pᵢ₀;
 *   Volume = (Q₁ − Q₀)·P̄₀ · Mix = Q₁·(Σ sᵢ₁pᵢ₀ − Σ sᵢ₀pᵢ₀) · Price = Σ qᵢ₁(pᵢ₁ − pᵢ₀).
 * They add up to the common items' revenue change exactly; new and lost items are separate effects
 * (+revenue of items only in period 1, −revenue of items only in period 0).
 */
export function pvm(items: readonly PvmItem[], unit: Unit = "currency"): Pvm {
  const both = items.filter((i) => i.q0 && i.q1 && i.r0 !== undefined && i.r1 !== undefined);
  const q0 = both.reduce((s, i) => s + (i.q0 ?? 0), 0);
  const q1 = both.reduce((s, i) => s + (i.q1 ?? 0), 0);
  const p = (r = 0, q = 1) => r / q;
  const avgP0 = q0 ? both.reduce((s, i) => s + ((i.q0 ?? 0) / q0) * p(i.r0, i.q0), 0) : 0;
  const mixP0 = q1 ? both.reduce((s, i) => s + ((i.q1 ?? 0) / q1) * p(i.r0, i.q0), 0) : 0;
  const inputs = both.flatMap((i) => [i.refs.r0, i.refs.q0, i.refs.r1, i.refs.q1].filter((r): r is Ref => r !== undefined));
  const calc = (name: string, label: string, value: number, refs: readonly Ref[] = inputs): Calc => ({
    name,
    label,
    value,
    unit,
    fn: "pvm.v1",
    inputs: refs,
  });
  const onlyNew = items.filter((i) => (i.r1 ?? 0) !== 0 && !(i.q0 && i.r0 !== undefined));
  const onlyLost = items.filter((i) => (i.r0 ?? 0) !== 0 && !(i.q1 && i.r1 !== undefined));
  const volume = calc("pvm:volume", "volume effect", (q1 - q0) * avgP0);
  const mix = calc("pvm:mix", "mix effect", q1 * (mixP0 - avgP0));
  const price = calc(
    "pvm:price",
    "price effect",
    both.reduce((s, i) => s + (i.q1 ?? 0) * (p(i.r1, i.q1) - p(i.r0, i.q0)), 0),
  );
  const newItems = calc(
    "pvm:new",
    "new items",
    onlyNew.reduce((s, i) => s + (i.r1 ?? 0), 0),
    onlyNew.flatMap((i) => (i.refs.r1 ? [i.refs.r1] : [])),
  );
  const lostItems = calc(
    "pvm:lost",
    "lost items",
    -onlyLost.reduce((s, i) => s + (i.r0 ?? 0), 0),
    onlyLost.flatMap((i) => (i.refs.r0 ? [i.refs.r0] : [])),
  );
  const total: Calc = {
    name: "pvm:total",
    label: "total change",
    value: volume.value + mix.value + price.value + newItems.value + lostItems.value,
    unit,
    fn: "sum",
    inputs: [volume, mix, price, newItems, lostItems].map((c) => calcRef(c.name)),
  };
  return { method: "pvm.v1", volume, mix, price, newItems, lostItems, total };
}

// ── 4.3 Rate vs mix (ratemix.v1) and the Simpson guard ──────────────────────────────────────────────────────

export interface RateSegment {
  readonly key: string;
  readonly num0: number;
  readonly den0: number;
  readonly num1: number;
  readonly den1: number;
  readonly refs?: readonly Ref[];
}

export interface RateMix {
  readonly method: "ratemix.v1";
  readonly overall0: number;
  readonly overall1: number;
  readonly mix: Calc;
  readonly rate: Calc;
  readonly segments: readonly {
    readonly key: string;
    readonly r0: number;
    readonly r1: number;
    readonly w0: number;
    readonly w1: number;
  }[];
  /** The overall rate moves against most segment rates: the finding must tell the segment story (spec §4.3). */
  readonly simpsonRisk: boolean;
}

/**
 * For r = Σ wᵢrᵢ with wᵢ = segment share of the denominator (spec §4.3):
 *   Mix = Σ (wᵢ₁ − wᵢ₀) rᵢ₀ · Rate = Σ wᵢ₁ (rᵢ₁ − rᵢ₀); Mix + Rate = r₁ − r₀ for segments present in both.
 * Rates are fractions here; the runner scales percent metrics.
 */
export function rateMix(segments: readonly RateSegment[], unit: Unit = "ratio"): RateMix {
  const both = segments.filter((s) => s.den0 > 0 && s.den1 > 0);
  const d0 = both.reduce((a, s) => a + s.den0, 0);
  const d1 = both.reduce((a, s) => a + s.den1, 0);
  const rows = both.map((s) => ({ key: s.key, r0: s.num0 / s.den0, r1: s.num1 / s.den1, w0: s.den0 / d0, w1: s.den1 / d1 }));
  const overall0 = both.reduce((a, s) => a + s.num0, 0) / d0;
  const overall1 = both.reduce((a, s) => a + s.num1, 0) / d1;
  const refs = both.flatMap((s) => s.refs ?? []);
  const mix: Calc = {
    name: "ratemix:mix",
    label: "mix effect",
    value: rows.reduce((a, r) => a + (r.w1 - r.w0) * r.r0, 0),
    unit,
    fn: "ratemix.v1",
    inputs: refs,
  };
  const rate: Calc = {
    name: "ratemix:rate",
    label: "rate effect",
    value: rows.reduce((a, r) => a + r.w1 * (r.r1 - r.r0), 0),
    unit,
    fn: "ratemix.v1",
    inputs: refs,
  };
  const overallDir = Math.sign(overall1 - overall0);
  const against = rows.filter((r) => Math.sign(r.r1 - r.r0) === -overallDir && overallDir !== 0).length;
  return {
    method: "ratemix.v1",
    overall0,
    overall1,
    mix,
    rate,
    segments: rows,
    simpsonRisk: overallDir !== 0 && against > rows.length / 2,
  };
}

// ── 4.4 Risk-ratio explanation (diff.v1, after MacroBase DIFF) ──────────────────────────────────────────────

export interface EventGroup {
  /** Attribute values of a group of events, e.g. { channel: "retail", product: "Drip bags" }. */
  readonly attrs: Readonly<Record<string, string>>;
  readonly a: number; // events in the anomalous period A
  readonly b: number; // events in the baseline period B
}

export interface DiffCombination {
  readonly attrs: Readonly<Record<string, string>>;
  readonly support: number;
  readonly riskRatio: number;
  readonly score: number;
}

/**
 * Over attribute combinations of 1–2 dimensions (spec §4.4): support = share of A's events with the
 * combination; risk ratio = (a / (a + b)) / (c / (c + d)) where a, b are A and B events with the combination
 * and c, d those without. Keep support ≥ 5% and RR ≥ 2; at most 5, ranked by support × log(RR).
 */
export function diff(
  groups: readonly EventGroup[],
  options: { minSupport?: number; minRiskRatio?: number; top?: number } = {},
): DiffCombination[] {
  const totalA = groups.reduce((s, g) => s + g.a, 0);
  const totalB = groups.reduce((s, g) => s + g.b, 0);
  const dims = [...new Set(groups.flatMap((g) => Object.keys(g.attrs)))].sort();
  const combos = new Map<string, { attrs: Record<string, string>; a: number; b: number }>();
  const add = (attrs: Record<string, string>, g: EventGroup) => {
    const key = JSON.stringify(Object.entries(attrs).sort());
    const c = combos.get(key) ?? { attrs, a: 0, b: 0 };
    c.a += g.a;
    c.b += g.b;
    combos.set(key, c);
  };
  for (const g of groups) {
    for (const [i, d1] of dims.entries()) {
      const v1 = g.attrs[d1];
      if (v1 === undefined) continue;
      add({ [d1]: v1 }, g);
      for (const d2 of dims.slice(i + 1)) {
        const v2 = g.attrs[d2];
        if (v2 !== undefined) add({ [d1]: v1, [d2]: v2 }, g);
      }
    }
  }
  const out: DiffCombination[] = [];
  for (const c of combos.values()) {
    const a = c.a;
    const b = c.b;
    const cc = totalA - a;
    const d = totalB - b;
    const support = totalA ? a / totalA : 0;
    const exposed = a + b ? a / (a + b) : 0;
    const unexposed = cc + d ? cc / (cc + d) : 0;
    const riskRatio = unexposed > 0 ? exposed / unexposed : exposed > 0 ? Number.POSITIVE_INFINITY : 0;
    if (support >= (options.minSupport ?? 0.05) && riskRatio >= (options.minRiskRatio ?? 2)) {
      out.push({ attrs: c.attrs, support, riskRatio, score: support * Math.log(Number.isFinite(riskRatio) ? riskRatio : 1e9) });
    }
  }
  // Ties go to the simpler explanation (fewer attributes), then alphabetical, so results are deterministic.
  const size = (c: DiffCombination) => Object.keys(c.attrs).length;
  return out
    .sort((x, y) => y.score - x.score || size(x) - size(y) || JSON.stringify(x.attrs).localeCompare(JSON.stringify(y.attrs)))
    .slice(0, options.top ?? 5);
}
