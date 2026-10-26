// The effects shared by pvm.v1 (revenue, analysis-library §4.2) and pvm_margin.v1 (margin, §10) over the items present in
// both periods with a quantity in each. pvm.v1 is the case of unit cost 0: its unit margin is the unit price.
// Pure arithmetic on numbers; the callers turn the results into calcs with their inputs.

/** One common item: quantities and unit prices/costs of both periods. */
export interface CommonItem {
  readonly q0: number;
  readonly q1: number;
  readonly p0: number;
  readonly p1: number;
  readonly c0: number;
  readonly c1: number;
}

export interface CommonEffects {
  readonly volume: number;
  readonly mix: number;
  readonly price: number;
  /** −Σ q₁(c₁ − c₀): 0 when there is no unit cost. */
  readonly cost: number;
}

/** Below this share of Σ|q₀|, a base quantity counts as 0: returns netting out leave floating-point dust, not a base. */
const ZERO_BASE = 1e-12;

/**
 * With Q = Σqᵢ, unit margin uᵢ = pᵢ − cᵢ and ū₀ = Σ qᵢ₀uᵢ₀ ÷ Q₀:
 *   Volume = (Q₁ − Q₀)·ū₀ · Mix = Σ qᵢ₁uᵢ₀ − Q₁·ū₀ · Price = Σ qᵢ₁(pᵢ₁ − pᵢ₀) · Cost = −Σ qᵢ₁(cᵢ₁ − cᵢ₀).
 * They add up to Σ qᵢ₁uᵢ₁ − Σ qᵢ₀uᵢ₀ exactly. Zero base (§10): when Q₀ = 0 (returns netting out) there is no average
 * unit margin, so Volume = 0 and Mix = Σ qᵢ₁uᵢ₀ − Σ qᵢ₀uᵢ₀, which keeps the identity.
 */
export function commonEffects(items: readonly CommonItem[]): CommonEffects {
  const q0 = items.reduce((s, i) => s + i.q0, 0);
  const q1 = items.reduce((s, i) => s + i.q1, 0);
  const scale = items.reduce((s, i) => s + Math.abs(i.q0), 0);
  const base = items.reduce((s, i) => s + i.q0 * (i.p0 - i.c0), 0);
  const next = items.reduce((s, i) => s + i.q1 * (i.p0 - i.c0), 0);
  const zeroBase = Math.abs(q0) <= ZERO_BASE * scale;
  return {
    volume: zeroBase ? 0 : (q1 - q0) * (base / q0),
    mix: zeroBase ? next - base : next - q1 * (base / q0),
    price: items.reduce((s, i) => s + i.q1 * (i.p1 - i.p0), 0),
    cost: -items.reduce((s, i) => s + i.q1 * (i.c1 - i.c0), 0),
  };
}
