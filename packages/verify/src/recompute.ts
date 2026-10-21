// V2 (agent-and-verifier §7): every fact is computed again and must match exactly (relative tolerance 1e-9).
// SQL facts are re-run with their stored parameters. Function facts are recomputed from their input facts by a
// registry that mirrors each analysis function; a function without an entry can't be verified, which is itself
// an engine bug. A mismatch is never "dropped": the job fails with a diagnostic.
import {
  COST_BOUNDS,
  hhi,
  mad,
  mannKendall,
  mean,
  median,
  parseQuotedRange,
  pvm,
  rateMix,
  robustZ,
  SCENARIO_BOUNDS,
  theilSen,
} from "@agentic-analytics/analysis";
import type { Fact } from "@agentic-analytics/schema";
import type { Workspace } from "@agentic-analytics/store";

export const TOLERANCE = 1e-9;

export function same(a: number, b: number): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  return Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
}

export interface Recomputed {
  readonly fact: string;
  readonly stored: number;
  /** The recomputed value, or the candidates it had to be one of (membership checks). */
  readonly computed: number | readonly number[];
  readonly ok: boolean;
  readonly how: string;
}

type Rule = (f: Fact, inputs: readonly number[], byId: ReadonlyMap<string, Fact>) => { value: number | number[]; how: string };

const suffix = (f: Fact) => f.label.slice(f.label.lastIndexOf(":") + 1);
const groups = (xs: readonly number[], n: number) =>
  Array.from({ length: Math.floor(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

const RULES: Record<string, Rule> = {
  delta: (_f, x) => ({ value: (x[0] ?? Number.NaN) - (x[1] ?? Number.NaN), how: "a − b" }),
  sum: (_f, x) => ({ value: x.reduce((a, b) => a + b, 0), how: "Σ inputs" }),
  abs: (_f, x) => ({ value: Math.abs(x[0] ?? Number.NaN), how: "|a|" }),
  // 1 when the first input moved by more than the second (a member beyond the whole change); a comparison is recorded
  // as a fact so "more than the whole drop" is recomputed like any number (analysis-library §4.1).
  abs_exceeds: (_f, x) => ({ value: Math.abs(x[0] ?? Number.NaN) > Math.abs(x[1] ?? Number.NaN) ? 1 : 0, how: "|a| > |b| ? 1 : 0" }),
  mean: (_f, x) => ({ value: mean(x), how: "mean of inputs" }),
  trailing_mean_3: (_f, x) => ({ value: mean(x), how: "mean of the three periods" }),
  pct_change: (_f, x) => ({ value: (x[1] ?? 0) !== 0 ? ((x[0] ?? 0) / (x[1] as number) - 1) * 100 : Number.NaN, how: "(a ÷ b − 1) × 100" }),
  "contribution.v1": (_f, x) => ({
    value: (x[1] ?? 0) !== 0 ? ((x[0] ?? 0) / (x[1] as number)) * 100 : Number.NaN,
    how: "member Δ ÷ total Δ × 100",
  }),
  // concentration.v1 reports the largest *named* member: the "(other)" bucket counts in the total, never as the top.
  share: (f, x, byId) => {
    const total = x.reduce((a, b) => a + b, 0);
    const named = x.filter((_, i) => !(byId.get(f.computation.inputs?.[i] ?? "")?.label ?? "").includes("=(other)]"));
    return {
      value: total && named.length ? (named.reduce((m, v) => Math.max(m, v), -Infinity) / total) * 100 : Number.NaN,
      how: "largest named member ÷ Σ × 100",
    };
  },
  hhi: (_f, x) => {
    const total = x.reduce((a, b) => a + b, 0);
    return { value: hhi(x.map((v) => v / total)), how: "Σ share²" };
  },
  theil_sen: (_f, x) => ({ value: theilSen(x), how: "Theil–Sen over the series" }),
  mann_kendall: (_f, x) => ({ value: mannKendall(x).p, how: "Mann–Kendall p" }),
  // The z of one residual: it must be the z of one of the series' period-over-period changes.
  // The z of the change into the fact's own period (named in its label) vs the series' other changes.
  robust_z: (f, x, byId) => {
    const res = x.slice(1).map((v, i) => v - (x[i] as number));
    const z = (i: number) => {
      const others = res.filter((_, j) => j !== i);
      return robustZ(res[i] as number, median(others), mad(others));
    };
    const period = /(\d{4}-\d{2}(?:-\d{2})?|\d{4}-[QW]\d{1,2})(?::robust_z)?$/.exec(f.label.replace(/:robust_z$/, ""))?.[1];
    const at = (f.computation.inputs ?? []).findIndex((id) => (byId.get(id)?.label ?? "").endsWith(`_${period}`));
    if (at >= 1) return { value: z(at - 1), how: `robust z of the change into ${period}` };
    // Fail closed: every anomaly label ends with its period, so a missing one is an engine bug.
    return { value: [], how: "robust z: the fact's period is not in its label or inputs" };
  },
  // The largest member share shift: one of the members' (after ÷ Σafter − before ÷ Σbefore) × 100.
  share_shift: (_f, x) => {
    const pairs = groups(x, 2);
    const s0 = pairs.reduce((a, p) => a + (p[0] as number), 0);
    const s1 = pairs.reduce((a, p) => a + (p[1] as number), 0);
    return { value: pairs.map((p) => ((p[1] as number) / s1 - (p[0] as number) / s0) * 100), how: "member share shift (pp)" };
  },
  "pvm.v1": (f, x) => {
    const effect = suffix(f);
    if (effect === "new") return { value: x.reduce((a, b) => a + b, 0), how: "Σ revenue of new items" };
    if (effect === "lost") return { value: -x.reduce((a, b) => a + b, 0), how: "−Σ revenue of lost items" };
    const items = groups(x, 4).map((g, i) => ({
      key: String(i),
      r0: g[0] as number,
      q0: g[1] as number,
      r1: g[2] as number,
      q1: g[3] as number,
      refs: {},
    }));
    if (effect === "unpriced")
      return { value: items.reduce((a, it) => a + (it.r1 ?? 0) - (it.r0 ?? 0), 0), how: "Σ (r1 − r0) of unpriced items" };
    const p = pvm(items, f.unit);
    const pick = { volume: p.volume, mix: p.mix, price: p.price } as Record<string, { value: number }>;
    return { value: pick[effect]?.value ?? Number.NaN, how: `pvm.v1 ${effect} over the common items` };
  },
  "ratemix.v1": (f, x) => {
    const segs = groups(x, 4).map((g, i) => ({
      key: String(i),
      num0: g[0] as number,
      den0: g[1] as number,
      num1: g[2] as number,
      den1: g[3] as number,
    }));
    const r = rateMix(segs, f.unit, f.unit === "percent" ? 100 : 1);
    const pick = { mix: r.mix, rate: r.rate, entering: r.entering, exiting: r.exiting, unattributed: r.unattributed } as Record<
      string,
      { value: number }
    >;
    return { value: pick[suffix(f)]?.value ?? Number.NaN, how: `ratemix.v1 ${suffix(f)}` };
  },
  "benchmark_gap.v1": (_f, x) => {
    const [own, low, high] = x as [number, number, number];
    return { value: own > high ? own - high : own < low ? own - low : 0, how: "distance to the external range" };
  },
};

function impactRule(f: Fact, byId: ReadonlyMap<string, Fact>): { value: number; how: string } {
  const type = (f.computation.fn ?? "").split(":")[1] ?? "";
  const inputs = (f.computation.inputs ?? []).map((id) => byId.get(id));
  const params = inputs.filter((x) => x?.computation.fn === "scenario_param");
  const amounts = inputs.filter((x) => x && x.computation.fn !== "scenario_param").map((x) => x?.value ?? Number.NaN);
  const share = (params.find((p) => /param_(low|high)$/.test(p?.label ?? ""))?.value ?? Number.NaN) / 100;
  const cost = (params.find((p) => /param_cost$/.test(p?.label ?? ""))?.value ?? 0) / 100;
  const [a0 = Number.NaN, a1 = Number.NaN, a2 = Number.NaN] = amounts;
  switch (type) {
    case "recover_share":
      return { value: Math.abs(a0) * share * (1 - cost), how: "|lost| × share × (1 − discount)" };
    case "price_change":
      return { value: a0 * share, how: "revenue × price change" };
    case "remove_excess_rate":
      return { value: ((a0 - a1) / 100) * a2 * share, how: "(current − baseline) ÷ 100 × base × share" };
    case "retain_at_risk":
      return { value: a0 * share * (1 - cost), how: "at risk × share × (1 − cost)" };
    default:
      return { value: Number.NaN, how: `unknown scenario ${type}` };
  }
}

export class VerifyError extends Error {
  constructor(
    readonly code: "RECOMPUTE_MISMATCH" | "REDERIVE_MISMATCH" | "CITATION_MISMATCH" | "UNVERIFIABLE",
    message: string,
    readonly diagnostic: unknown,
  ) {
    super(message);
    this.name = "VerifyError";
  }
}

async function rerunSql(ws: Workspace, f: Fact): Promise<number> {
  const params = Object.entries(f.computation.params ?? {})
    .filter(([k]) => /^\$\d+$/.test(k))
    .sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))
    .map(([, v]) => v as string | number | boolean | null);
  const rows = await ws.all<{ value: number | null }>({ text: f.computation.sql ?? "", params });
  // An additive metric with no rows in a period is 0 (report-schema §3, factbook); the SQL returns no row then.
  return Number(rows[0]?.value ?? 0);
}

/** V2 over a set of facts (the report's, with every input they depend on available in `all`). */
export async function recomputeFacts(ws: Workspace, facts: readonly Fact[], all: ReadonlyMap<string, Fact>): Promise<Recomputed[]> {
  const out: Recomputed[] = [];
  for (const f of facts) {
    const c = f.computation;
    if (c.kind === "sql") {
      const v = await rerunSql(ws, f);
      out.push({ fact: f.id, stored: f.value, computed: v, ok: same(f.value, v), how: "SQL re-run" });
      continue;
    }
    const fn = c.fn ?? "";
    if (fn === "external_quote") {
      const text = String(c.params?.text ?? "");
      const side = c.params?.side === "high" ? "high" : "low";
      const r = parseQuotedRange(text);
      const v = r ? r[side] : Number.NaN;
      out.push({ fact: f.id, stored: f.value, computed: v, ok: same(f.value, v), how: `parse “${text}” (${side})` });
      continue;
    }
    if (fn === "scenario_param") {
      // A parameter is a choice, not a computation: it must lie within the scenario's bounds.
      const type = /impact\.v1:(\w+)/.exec(f.label)?.[1] as keyof typeof SCENARIO_BOUNDS | undefined;
      // An unknown scenario type has no bounds: the fact fails as a mismatch with its `how`, never a TypeError.
      const [lo, hi] = /param_cost$/.test(f.label) ? COST_BOUNDS : ((type && SCENARIO_BOUNDS[type]) ?? [Number.NaN, Number.NaN]);
      const ok = f.value / 100 >= lo - TOLERANCE && f.value / 100 <= hi + TOLERANCE;
      out.push({ fact: f.id, stored: f.value, computed: [lo * 100, hi * 100], ok, how: "scenario parameter within bounds" });
      continue;
    }
    const inputs = (c.inputs ?? []).map((id) => all.get(id)?.value ?? Number.NaN);
    if (fn.startsWith("impact.v1:")) {
      const r = impactRule(f, all);
      out.push({ fact: f.id, stored: f.value, computed: r.value, ok: same(f.value, r.value), how: r.how });
      continue;
    }
    const rule = RULES[fn];
    if (!rule) {
      out.push({ fact: f.id, stored: f.value, computed: Number.NaN, ok: false, how: `no recompute rule for ${fn || "(none)"}` });
      continue;
    }
    const r = rule(f, inputs, all);
    const ok = Array.isArray(r.value) ? r.value.some((v) => same(f.value, v)) : same(f.value, r.value as number);
    out.push({ fact: f.id, stored: f.value, computed: r.value, ok, how: r.how });
  }
  return out;
}
