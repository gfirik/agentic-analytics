// The golden set (docs/specs/accuracy.md §1–§3): reviewed questions with expected answers computed by SQL apart from
// the engine, scored against what the engine answered — a named fact of the report, the top driver of a named finding,
// or the facts an `aa ask` answer cites. Free text is never judged: a trap passes only on a structured refusal.
import type { Answer } from "@agentic-analytics/core";
import type { Report } from "@agentic-analytics/schema";
import { parse } from "yaml";
import { z } from "zod";
import { EvalRunError } from "./errors.ts";
import { subjectOf } from "./score.ts";

/** Where an item's answer is read from. Only that place is compared: a matching but unrelated fact scores nothing. */
const Source = z.discriminatedUnion("kind", [
  /** A fact of the report, by its label (`revenue_2026-04`, `revenue[channel=wholesale]_2026-04`). */
  z.object({ kind: z.literal("fact"), label: z.string().min(1) }),
  /** The top driver of the report's finding on `metric` at `period` (its first `drivers` entry). */
  z.object({ kind: z.literal("driver"), metric: z.string().min(1), period: z.string().min(1) }),
  /** The `aa ask` answer's first claim and the facts it cites; a trap passes only on an answer with no verified claim. */
  z.object({ kind: z.literal("ask") }),
  /**
   * A trap whose right answer is "this analysis can't be run on this data" (accuracy.md §2): it passes when the report's
   * "Analyses not run" lists `analysis` with a reason, and states no fact of that analysis.
   */
  z.object({ kind: z.literal("not_run"), analysis: z.string().min(1) }),
]);

/** What an item exercises (accuracy.md §1); the M15 bars are computed per capability. */
export const CAPABILITIES = ["kpi", "margin", "pareto", "driver", "other"] as const;
export const Capability = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof Capability>;

const Review = z.object({
  reviewed_by: z.string().min(1),
  date: z.iso.date(),
  /** How the reviewer re-derived the answer: their own SQL, or a published figure. */
  method: z.enum(["independent_sql", "published_figure"]),
  /** Whether the re-derivation agrees; only agreeing items count toward the bars. */
  agrees: z.boolean(),
});

const Base = {
  id: z.string().regex(/^G\d+$/),
  question: z.string().min(5),
  capability: Capability,
  source: Source,
  /** The columns the question is about (the ablation's support set reads source cells from these only). */
  columns: z.array(z.string()).default([]),
  /** The SQL that computes the expected answer on the dataset's tables, written apart from the engine. */
  sql: z.string().min(1).optional(),
  split: z.enum(["dev", "heldout"]),
  review: Review.optional(),
};

export const GoldenItem = z.discriminatedUnion("kind", [
  z.object({
    ...Base,
    kind: z.literal("numeric"),
    expected: z.number(),
    /** Absolute and relative tolerance; a value passes when within either. */
    tolerance: z.object({ abs: z.number().nonnegative().default(0), rel: z.number().nonnegative().default(0) }).default({ abs: 0, rel: 0 }),
  }),
  z.object({ ...Base, kind: z.literal("categorical"), expected: z.string().min(1) }),
  /** A question the data can't answer: the right answer is a refusal. */
  z.object({ ...Base, kind: z.literal("trap"), reason: z.string().min(5) }),
]);
export type GoldenItem = z.infer<typeof GoldenItem>;

export const GoldenSet = z.object({ dataset: z.string().min(1), items: z.array(GoldenItem).min(1) }).superRefine((s, ctx) => {
  const ids = new Set<string>();
  for (const [i, item] of s.items.entries()) {
    if (ids.has(item.id)) ctx.addIssue({ code: "custom", path: ["items", i, "id"], message: `duplicate id ${item.id}` });
    ids.add(item.id);
    if (item.kind === "trap" && item.source.kind !== "ask" && item.source.kind !== "not_run")
      ctx.addIssue({ code: "custom", path: ["items", i, "source"], message: "a trap is answered through ask (a refusal) or not_run" });
    if (item.kind !== "trap" && item.source.kind === "not_run")
      ctx.addIssue({ code: "custom", path: ["items", i, "source"], message: "only a trap may use the not_run source" });
    // Combinations that could never pass are authoring slips: refused at load, not reported as engine misses.
    if (item.kind === "numeric" && item.source.kind === "driver")
      ctx.addIssue({ code: "custom", path: ["items", i, "source"], message: "a driver answers categorical items only" });
    if (item.kind === "categorical" && item.source.kind === "fact")
      ctx.addIssue({ code: "custom", path: ["items", i, "source"], message: "a fact answers numeric items only" });
  }
});
export type GoldenSet = z.infer<typeof GoldenSet>;

export function parseGoldenSet(text: string): GoldenSet {
  const parsed = GoldenSet.safeParse(parse(text));
  if (!parsed.success)
    throw new EvalRunError(
      "BAD_RESULTS",
      `invalid golden set: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  return parsed.data;
}

export interface GoldenScore {
  readonly id: string;
  readonly kind: GoldenItem["kind"];
  readonly split: GoldenItem["split"];
  readonly capability: Capability;
  readonly pass: boolean;
  /** What the engine answered, for the results page. */
  readonly got: string;
  /** Counts toward the bars: reviewed, and the reviewer's re-derivation agreed. */
  readonly counts: boolean;
}

/** Within the item's absolute or relative tolerance (a tolerance of 0 means exact). */
export function withinTolerance(got: number, expected: number, tol: { abs: number; rel: number }): boolean {
  const diff = Math.abs(got - expected);
  return diff <= tol.abs || diff <= tol.rel * Math.abs(expected) || got === expected;
}

/**
 * Scores one item against the report and, for `ask` items, the answer to its question (accuracy.md §2).
 * - A refusal is an answer with no verified claim; `notCovered` alongside claims is a caveat, not a refusal.
 * - A numeric `ask` item passes when a fact the answer's first claim cites is within tolerance.
 * - A categorical `ask` item passes when the facts the first claim cites name exactly one member, and it is the
 *   expected one; an answer that cites several members (every channel's change) names no single answer.
 */
export function scoreGoldenItem(item: GoldenItem, report: Report, answer?: Answer): GoldenScore {
  const counts = item.review?.agrees === true;
  const out = (pass: boolean, got: string): GoldenScore => ({
    id: item.id,
    kind: item.kind,
    split: item.split,
    capability: item.capability,
    pass,
    got,
    counts,
  });
  const src = item.source;
  if (src.kind === "not_run") return out(...scoreNotRun(src.analysis, report));
  if (item.kind === "trap") {
    if (!answer) return out(false, "no answer");
    const refused = answer.claims.length === 0;
    return out(
      refused,
      refused ? `refused: ${answer.notCovered ?? "no verified claim"}` : `answered with ${answer.claims.length} claim(s)`,
    );
  }
  if (src.kind === "fact") {
    const fact = report.facts.find((f) => f.label === src.label);
    if (!fact) return out(false, `no fact ${src.label}`);
    return item.kind === "numeric"
      ? out(withinTolerance(fact.value, item.expected, item.tolerance), String(fact.value))
      : out(false, "unreachable");
  }
  if (src.kind === "driver") {
    // The finding about that change: its subject (metric, no member, the period it is at), as the planted matcher reads it.
    const finding = report.findings.find((f) => {
      const s = subjectOf(f, report);
      return s !== undefined && s.metric === src.metric && s.member === undefined && s.period === src.period;
    });
    const top = finding?.drivers?.[0]?.label.replace(/[“”"]/g, "").trim();
    if (!top) return out(false, finding ? "no driver" : `no finding on ${src.metric} at ${src.period}`);
    return item.kind === "categorical" ? out(top.toLowerCase() === item.expected.toLowerCase(), top) : out(false, "unreachable");
  }
  // ask
  if (!answer) return out(false, "no answer");
  if (answer.claims.length === 0) return out(false, `refused: ${answer.notCovered ?? "no verified claim"}`);
  const cited = new Set(answer.claims[0]?.facts ?? []);
  const facts = answer.facts.filter((f) => cited.has(f.id));
  if (item.kind === "numeric") {
    const hit = facts.find((f) => withinTolerance(f.value, item.expected, item.tolerance));
    return out(hit !== undefined, hit ? `${hit.id} = ${hit.value}` : facts.map((f) => `${f.id} = ${f.value}`).join(", ") || "no facts");
  }
  const members = [...new Set(facts.flatMap((f) => memberOf(f.label) ?? []).map((m) => m.toLowerCase()))];
  if (members.length !== 1) return out(false, members.length ? `several members: ${members.join(", ")}` : "no member cited");
  return out(members[0] === item.expected.toLowerCase(), members[0] as string);
}

/**
 * The `not_run` source (accuracy.md §2): the report's `analyses_not_run` entry for `analysis` must exist with a reason,
 * and no fact of that analysis may be stated (a report that refuses an analysis and also states it contradicts itself).
 * A report from before M15 PR 10 has no `analyses_not_run`, so a not_run item is a miss there (the M14 baseline).
 */
export function scoreNotRun(analysis: string, report: Report): [boolean, string] {
  const entry = (report.analyses_not_run ?? []).find((e) => e.analysis === analysis);
  if (!entry) return [false, `no "Analyses not run" entry for ${analysis}`];
  if (!entry.reason.trim()) return [false, `${analysis} is listed without a reason`];
  // Fact labels of an analysis start with its id without a version suffix (`pvm_margin.v1` → `pvm_margin.`).
  const stem = analysis.replace(/\.v\d+$/, "");
  // A period (or year) follows the stem after "_", so `gross_margin_pct_2026-03` is another analysis's fact, not this one's.
  const stated = report.facts.find(
    (f) => f.label === stem || new RegExp(`^${stem.replace(/[.\\[\]]/g, "\\$&")}(_\\d|[.\\[])`).test(f.label),
  );
  if (stated) return [false, `listed as not run, yet the report states ${stated.label}`];
  return [true, `not run: ${entry.reason.trim()}`];
}

/** The member of a measured fact's label (`revenue[channel=wholesale]_2026-04` → wholesale); one filter only. */
function memberOf(label: string): string | undefined {
  const m = /\[([^=\],]+)=([^\],]+)\]/.exec(label);
  // Published members keep their padding ("Non Refund     "), and a padded label must still match the expected member.
  return m?.[2]?.trim();
}

export interface GoldenSummary {
  /** Items that count toward the bars (reviewed and agreed), per kind. */
  readonly numericCategorical: { readonly passed: number; readonly of: number };
  readonly traps: { readonly passed: number; readonly of: number };
  /** Items scored but not counted (unreviewed, or the reviewer disagreed). */
  readonly notCounted: number;
  /** Counted items per capability: how many, and how many passed (traps included). */
  readonly byCapability: Readonly<Record<Capability, { readonly passed: number; readonly of: number }>>;
}

/** The bars' counts for one split (the §4.7 numeric bar is on the held-out split), or both when none is given. */
export function summarizeGolden(all: readonly GoldenScore[], split?: GoldenItem["split"]): GoldenSummary {
  const scores = split ? all.filter((s) => s.split === split) : all;
  const counted = scores.filter((s) => s.counts);
  const answers = counted.filter((s) => s.kind !== "trap");
  const traps = counted.filter((s) => s.kind === "trap");
  return {
    numericCategorical: { passed: answers.filter((s) => s.pass).length, of: answers.length },
    traps: { passed: traps.filter((s) => s.pass).length, of: traps.length },
    notCounted: scores.length - counted.length,
    byCapability: Object.fromEntries(
      CAPABILITIES.map((c) => {
        const mine = counted.filter((s) => s.capability === c);
        return [c, { passed: mine.filter((s) => s.pass).length, of: mine.length }];
      }),
    ) as GoldenSummary["byCapability"],
  };
}

/** A capability's bar (docs/plans/m15.md A4): the M14 baseline rate + 15 percentage points, or 85%, whichever is higher. */
export function capabilityBar(baselineRate: number): number {
  return Math.max(baselineRate + 0.15, 0.85);
}

/** A small seeded PRNG (mulberry32): the bootstrap must give the same interval on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PairedDifference {
  /** Mean of b − a over the tasks. */
  readonly mean: number;
  /** The 95% percentile interval of that mean over the resamples. */
  readonly low: number;
  readonly high: number;
  readonly resamples: number;
  readonly seed: number;
}

/**
 * The paired bootstrap (accuracy.md §5): per-task differences b − a, resampled with replacement `resamples` times
 * with a fixed seed, and the 2.5th and 97.5th percentiles of the resampled means (the sorted means at indices
 * ⌊0.025·R⌋ and ⌊0.975·R⌋). "b adds accuracy" is claimed only when `low > 0`.
 */
export function pairedBootstrap(
  a: readonly number[],
  b: readonly number[],
  { resamples = 10_000, seed = 20261022 }: { resamples?: number; seed?: number } = {},
): PairedDifference {
  if (a.length !== b.length) throw new EvalRunError("USAGE", `paired bootstrap needs paired tasks (${a.length} vs ${b.length})`);
  if (!a.length) throw new EvalRunError("USAGE", "paired bootstrap needs at least one task");
  if (!Number.isInteger(resamples) || resamples < 1)
    throw new EvalRunError("USAGE", `resamples must be a whole number above 0, not ${resamples}`);
  if (![...a, ...b].every(Number.isFinite)) throw new EvalRunError("USAGE", "paired bootstrap scores must be finite numbers");
  const d = b.map((v, i) => v - (a[i] as number));
  const n = d.length;
  const mean = d.reduce((s, v) => s + v, 0) / n;
  const rand = mulberry32(seed);
  const means = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += d[Math.floor(rand() * n)] as number;
    means[r] = s / n;
  }
  means.sort();
  const at = (q: number) => means[Math.min(resamples - 1, Math.max(0, Math.floor(q * resamples)))] as number;
  return { mean, low: at(0.025), high: at(0.975), resamples, seed };
}
