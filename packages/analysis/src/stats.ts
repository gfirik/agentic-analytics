// Statistics used by the analysis library (docs/specs/analysis-library.md §2–3). Pure, deterministic,
// no I/O. Every function has a hand-computed test.

export function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN;
}

export function median(xs: readonly number[]): number {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** Median absolute deviation (unscaled). */
export function mad(xs: readonly number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/** MAD scaled to a normal standard deviation (×1.4826). */
export const MAD_SCALE = 1.4826;

/** (x − median) / (1.4826 · MAD); NaN when MAD is 0. */
export function robustZ(x: number, center: number, madValue: number): number {
  return madValue > 0 ? (x - center) / (MAD_SCALE * madValue) : Number.NaN;
}

/** Theil–Sen slope: the median of all pairwise slopes (x_j − x_i) / (j − i), per period. */
export function theilSen(ys: readonly number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < ys.length; i++)
    for (let j = i + 1; j < ys.length; j++) slopes.push(((ys[j] as number) - (ys[i] as number)) / (j - i));
  return median(slopes);
}

/** Standard normal CDF via Abramowitz–Stegun 7.1.26 (|error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export interface MannKendall {
  readonly s: number;
  readonly variance: number;
  readonly z: number;
  /** Two-sided p-value (normal approximation with tie correction). */
  readonly p: number;
}

/** Mann–Kendall trend test: S = Σ sign(x_j − x_i); Var(S) with tie correction; continuity-corrected Z. */
export function mannKendall(xs: readonly number[]): MannKendall {
  const n = xs.length;
  let s = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) s += Math.sign((xs[j] as number) - (xs[i] as number));
  const ties = new Map<number, number>();
  for (const x of xs) ties.set(x, (ties.get(x) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of ties.values()) if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5);
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  const z = variance > 0 ? (s > 0 ? (s - 1) / Math.sqrt(variance) : s < 0 ? (s + 1) / Math.sqrt(variance) : 0) : 0;
  return { s, variance, z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}

export interface TwoProportion {
  readonly p1: number;
  readonly p2: number;
  readonly z: number;
  /** Two-sided p-value. */
  readonly p: number;
}

/** Two-proportion z-test with the pooled proportion (ratio_shift.v1 when counts are known). */
export function twoProportionZ(x1: number, n1: number, x2: number, n2: number): TwoProportion {
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  const z = se > 0 ? (p2 - p1) / se : 0;
  return { p1, p2, z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}

/** Herfindahl–Hirschman index of shares (fractions summing to 1). */
export function hhi(shares: readonly number[]): number {
  return shares.reduce((a, s) => a + s * s, 0);
}

/** Sum of squared errors around the mean. */
export function sse(xs: readonly number[]): number {
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0);
}
