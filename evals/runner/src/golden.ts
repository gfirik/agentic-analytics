// The golden set (docs/specs/accuracy.md §1–§3): reviewed questions with expected answers computed by SQL apart from
// the engine, scored against what the engine answered — a named fact of the report, the top driver of a named finding,
// or the facts an `aa ask` answer cites. Free text is never judged: a trap passes only on a structured refusal.
import type { Answer } from "@agentic-analytics/core";
import type { Report } from "@agentic-analytics/schema";
import { parse } from "yaml";
import { z } from "zod";
import { EvalRunError } from "./errors.ts";

/** Where an item's answer is read from. Only that place is compared: a matching but unrelated fact scores nothing. */
const Source = z.discriminatedUnion("kind", [
  /** A fact of the report, by its label (`revenue_2026-04`, `revenue[channel=wholesale]_2026-04`). */
  z.object({ kind: z.literal("fact"), label: z.string().min(1) }),
  /** The top driver of the report's finding on `metric` at `period` (its first `drivers` entry). */
  z.object({ kind: z.literal("driver"), metric: z.string().min(1), period: z.string().min(1) }),
  /** The facts an `aa ask` answer to the question cites; a trap passes on `notCovered` or no claims. */
  z.object({ kind: z.literal("ask") }),
]);

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
    if (item.kind === "trap" && item.source.kind !== "ask")
      ctx.addIssue({ code: "custom", path: ["items", i, "source"], message: "a trap is answered through ask (a refusal)" });
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
 * Scores one item against the report and, for `ask` items, the answer to its question. A numeric `ask` item passes when
 * a fact the answer cites is within tolerance; a categorical one when a cited fact's member is the expected value.
 */
export function scoreGoldenItem(item: GoldenItem, report: Report, answer?: Answer): GoldenScore {
  const counts = item.review?.agrees === true;
  const out = (pass: boolean, got: string): GoldenScore => ({ id: item.id, kind: item.kind, split: item.split, pass, got, counts });
  const src = item.source;
  if (item.kind === "trap") {
    if (!answer) return out(false, "no answer");
    const refused = answer.notCovered !== undefined || answer.claims.length === 0;
    return out(
      refused,
      refused ? `refused: ${answer.notCovered ?? "no verified claim"}` : `answered with ${answer.claims.length} claim(s)`,
    );
  }
  if (src.kind === "fact") {
    const fact = report.facts.find((f) => f.label === src.label);
    if (!fact) return out(false, `no fact ${src.label}`);
    if (item.kind === "numeric") return out(withinTolerance(fact.value, item.expected, item.tolerance), String(fact.value));
    return out(false, "a fact source answers numeric items only");
  }
  if (src.kind === "driver") {
    const finding = report.findings.find((f) => findingSubject(f, report, src.metric, src.period));
    const top = finding?.drivers?.[0]?.label.replace(/[“”"]/g, "").trim();
    if (!top) return out(false, finding ? "no driver" : `no finding on ${src.metric} at ${src.period}`);
    if (item.kind === "categorical") return out(top.toLowerCase() === item.expected.toLowerCase(), top);
    return out(false, "a driver source answers categorical items only");
  }
  // ask
  if (!answer) return out(false, "no answer");
  if (answer.notCovered !== undefined || answer.claims.length === 0)
    return out(false, `refused: ${answer.notCovered ?? "no verified claim"}`);
  const cited = new Set(answer.claims.flatMap((c) => c.facts));
  const facts = answer.facts.filter((f) => cited.has(f.id));
  if (item.kind === "numeric") {
    const hit = facts.find((f) => withinTolerance(f.value, item.expected, item.tolerance));
    return out(hit !== undefined, hit ? `${hit.id} = ${hit.value}` : facts.map((f) => `${f.id} = ${f.value}`).join(", ") || "no facts");
  }
  const members = facts.flatMap((f) => [...f.label.matchAll(/\[[^=\]]+=([^\]]+)\]/g)].map((m) => m[1] as string));
  const hit = members.find((m) => m.toLowerCase() === item.expected.toLowerCase());
  return out(hit !== undefined, hit ?? (members.join(", ") || "no member cited"));
}

/** Whether a finding is about `metric` at `period`: one of its first claim's facts is that metric's point in that period. */
function findingSubject(f: Report["findings"][number], report: Report, metric: string, period: string): boolean {
  const labels = new Map(report.facts.map((x) => [x.id, x.label]));
  return (f.claims[0]?.facts ?? []).some((id) => labels.get(id) === `${metric}_${period}`);
}

export interface GoldenSummary {
  /** Items that count toward the bars (reviewed and agreed), per kind. */
  readonly numericCategorical: { readonly passed: number; readonly of: number };
  readonly traps: { readonly passed: number; readonly of: number };
  /** Items scored but not counted (unreviewed, or the reviewer disagreed). */
  readonly notCounted: number;
}

export function summarizeGolden(scores: readonly GoldenScore[]): GoldenSummary {
  const counted = scores.filter((s) => s.counts);
  const answers = counted.filter((s) => s.kind !== "trap");
  const traps = counted.filter((s) => s.kind === "trap");
  return {
    numericCategorical: { passed: answers.filter((s) => s.pass).length, of: answers.length },
    traps: { passed: traps.filter((s) => s.pass).length, of: traps.length },
    notCounted: scores.length - counted.length,
  };
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
 * with a fixed seed, and the 2.5th and 97.5th percentiles of the resampled means. "b adds accuracy" is claimed only
 * when `low > 0`.
 */
export function pairedBootstrap(
  a: readonly number[],
  b: readonly number[],
  { resamples = 10_000, seed = 20261022 }: { resamples?: number; seed?: number } = {},
): PairedDifference {
  if (a.length !== b.length) throw new EvalRunError("USAGE", `paired bootstrap needs paired tasks (${a.length} vs ${b.length})`);
  if (!a.length) throw new EvalRunError("USAGE", "paired bootstrap needs at least one task");
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
