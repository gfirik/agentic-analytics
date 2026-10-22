// The ablation's measures (docs/specs/accuracy.md §8.4, analyst-grade §4.5), each a pure function with a
// hand-computed test. The same golden items, planted events and matchers score every arm: for arm C the eval runner's
// own scorers, for arms A and B the structured fields of their fixed JSON answer and the numbers in its prose.
import type { AnswerKey, Member, Planted } from "@agentic-analytics/eval-generator";
import {
  type GoldenItem,
  keyPeriod,
  matchesDistractor,
  matchesPlanted,
  type PlantedScore,
  type Subject,
  withinTolerance,
} from "@agentic-analytics/eval-runner";
import { claimedNumbers, readings } from "./numbers.ts";
import type { ChangesAnswer, QuestionAnswer } from "./prompts.ts";

export interface ItemScore {
  readonly id: string;
  readonly kind: GoldenItem["kind"];
  readonly pass: boolean;
  /** What the arm answered, for the results page. */
  readonly got: string;
}

/**
 * One golden item, from an arm's answer (undefined: the arm gave no valid answer, a miss):
 * - a trap passes only on `refused: true`; a caveat beside an answer is not a refusal (accuracy.md §2);
 * - an answerable item that is refused is a miss;
 * - numeric: some number claimed in `answer` (dates, ordinals, rank sizes and numbers echoed from the question left
 *   out) matches the expected value within the item's tolerance, in any of its `readings`;
 * - categorical: the `member` field equals the expected answer, case-insensitively.
 */
export function scoreArmItem(item: GoldenItem, answer: QuestionAnswer | undefined): ItemScore {
  const out = (pass: boolean, got: string): ItemScore => ({ id: item.id, kind: item.kind, pass, got });
  if (!answer) return out(false, "no answer");
  if (item.kind === "trap")
    return answer.refused ? out(true, `refused: ${answer.caveat ?? ""}`.trim()) : out(false, `answered: ${answer.answer.slice(0, 80)}`);
  if (answer.refused) return out(false, `refused: ${answer.caveat ?? ""}`.trim());
  if (item.kind === "numeric") {
    const nums = claimedNumbers(answer.answer, item.question);
    const hit = nums.find((n) => readings(n).some((v) => withinTolerance(v, item.expected, item.tolerance)));
    return out(hit !== undefined, hit ? hit.raw : nums.map((n) => n.raw).join(", ") || "no number");
  }
  const member = answer.member?.replace(/[“”"']/g, "").trim();
  if (!member) return out(false, "no member");
  return out(member.toLowerCase() === item.expected.toLowerCase(), member);
}

/** The tolerance a number is checked against the support set with: the item's, and at least 0.5% (prose rounds). */
export const supportTolerance = (item: GoldenItem) => {
  const t = item.kind === "numeric" ? item.tolerance : { abs: 0, rel: 0 };
  return { abs: t.abs, rel: Math.max(t.rel, 0.005) };
};

export interface Support {
  /** Every golden answer of the dataset. */
  readonly golden: readonly number[];
  /** Arm C's fact values for the same job (its report and its `ask` answers); empty when arm C did not run. */
  readonly facts: readonly number[];
  /** The numeric source cells of the columns an item refers to, by item id. */
  readonly cells: ReadonlyMap<string, readonly number[]>;
}

export interface UnsupportedCount {
  readonly numbers: number;
  /** Matching nothing in the support set (golden answers, arm C's facts, the item's source cells). */
  readonly unsupported: number;
  /** The same count with source cells left out of the support set. */
  readonly unsupportedWithoutCells: number;
}

/**
 * The unsupported numbers of one answer: each number claimed in `answer` (exclusions as in scoreArmItem) is
 * supported when one of its readings is within `supportTolerance(item)` of a value in the support set. A refused
 * answer or no answer claims nothing.
 */
export function unsupportedNumbers(item: GoldenItem, answer: QuestionAnswer | undefined, support: Support): UnsupportedCount {
  if (!answer || answer.refused) return { numbers: 0, unsupported: 0, unsupportedWithoutCells: 0 };
  const tol = supportTolerance(item);
  const near = (values: readonly number[]) => (v: number) => values.some((s) => withinTolerance(v, s, tol));
  const base = near([...support.golden, ...support.facts]);
  const cells = near(support.cells.get(item.id) ?? []);
  let unsupported = 0;
  let withoutCells = 0;
  const nums = claimedNumbers(answer.answer, item.question);
  for (const n of nums) {
    const rs = readings(n);
    const inBase = rs.some(base);
    if (!inBase) withoutCells++;
    if (!inBase && !rs.some(cells)) unsupported++;
  }
  return { numbers: nums.length, unsupported, unsupportedWithoutCells: withoutCells };
}

/** A metric name as arms A and B write it, in the answer key's terms: snake_case, and the plain sales words as revenue. */
export function armMetric(name: string): string {
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (/^(?:total_|monthly_|net_|gross_)?(?:revenue|sales|turnover|income)(?:_total)?$/.test(id)) return "revenue";
  if (/^(?:total_|monthly_)?(?:orders?|order_count|number_of_orders)$/.test(id)) return "orders";
  if (/^(?:refund|return)s?_rate$/.test(id)) return "refund_rate";
  return id;
}

const snake = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/** An arm's finding as the scorer's subject: metric, member, compared months and direction (accuracy.md §8.4). */
export function armSubject(f: ChangesAnswer["findings"][number]): Subject {
  return {
    metric: armMetric(f.metric),
    ...(f.member ? { member: { dimension: snake(f.member.dimension), member: f.member.member.trim() } } : {}),
    before: keyPeriod(f.before.trim()),
    period: keyPeriod(f.period.trim()),
    direction: f.direction,
  };
}

export interface ChangesScore {
  readonly planted: readonly PlantedScore[];
  readonly distractorsReported: readonly string[];
  readonly distractors: number;
}

const driverOk = (drivers: readonly string[], accepted: readonly Member[]) => {
  const top = drivers[0]?.replace(/[“”"]/g, "").trim().toLowerCase();
  return top !== undefined && accepted.some((d) => top === d.member.toLowerCase());
};

/**
 * An arm's "what changed" answer against the dataset's key, with the eval's own subject matchers (score.ts): a
 * planted event is detected by a top-5 finding that matches it, its driver is right when the first `drivers` entry
 * is the expected member or an accepted alternative, and a distractor is reported by any finding that matches it.
 */
export function scoreArmChanges(answer: ChangesAnswer | undefined, key: Pick<AnswerKey, "planted" | "distractors">): ChangesScore {
  const findings = answer && !answer.refused ? answer.findings : [];
  const top = findings.slice(0, 5).map((f) => ({ f, s: armSubject(f) }));
  const planted = key.planted.map((p: Planted): PlantedScore => {
    const hits = top.flatMap((h, i) => (matchesPlanted(h.s, p) ? [{ ...h, rank: i + 1 }] : []));
    const first = hits[0];
    if (!first) return { id: p.id, detected: false };
    return {
      id: p.id,
      detected: true,
      rank: first.rank,
      ...(p.driver ? { driver: hits.some((h) => driverOk(h.f.drivers, [p.driver as Member, ...(p.driver_alternatives ?? [])])) } : {}),
    };
  });
  const all = findings.map(armSubject);
  return {
    planted,
    distractorsReported: key.distractors.filter((d) => all.some((s) => matchesDistractor(s, d))).map((d) => d.id),
    distractors: key.distractors.length,
  };
}

/** Planted recall@5 counts an event only when found with the correct driver (EVALS §2), as the main eval does. */
export const plantedFound = (p: PlantedScore) => p.detected && p.driver !== false;

export interface Rate {
  readonly n: number;
  readonly of: number;
}
export const rate = (n: number, of: number): Rate => ({ n, of });
export const shareOf = (r: Rate): number | undefined => (r.of === 0 ? undefined : r.n / r.of);

/** The smoke measures over every dataset's planted events and distractors. */
export function changesMeasures(scores: readonly ChangesScore[]): { recall5: Rate; driver: Rate; distractorFp: Rate } {
  const planted = scores.flatMap((s) => s.planted);
  const withDriver = planted.filter((p) => p.detected && p.driver !== undefined);
  return {
    recall5: rate(planted.filter(plantedFound).length, planted.length),
    driver: rate(withDriver.filter((p) => p.driver).length, withDriver.length),
    distractorFp: rate(
      scores.reduce((s, x) => s + x.distractorsReported.length, 0),
      scores.reduce((s, x) => s + x.distractors, 0),
    ),
  };
}

/** The golden measures over every item: numeric and categorical accuracy and the trap pass rate. */
export function goldenMeasures(scores: readonly ItemScore[]): { numeric: Rate; categorical: Rate; traps: Rate } {
  const of = (k: GoldenItem["kind"]) => scores.filter((s) => s.kind === k);
  const passed = (xs: readonly ItemScore[]) => rate(xs.filter((s) => s.pass).length, xs.length);
  return { numeric: passed(of("numeric")), categorical: passed(of("categorical")), traps: passed(of("trap")) };
}

/** The numeric values of a result's cells, for the support set and for citation checks. */
export function numericCells(rows: readonly (readonly unknown[])[]): number[] {
  const out: number[] = [];
  for (const r of rows)
    for (const v of r) {
      if (typeof v === "number" && Number.isFinite(v)) out.push(v);
      else if (typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v.trim())) out.push(Number(v));
    }
  return out;
}

/**
 * Citation validity for arm B (analyst-grade §4.5: its citation is the SQL it ran). The answer's citations are the
 * statements in its `sql` field (or, when it lists none, every statement it ran successfully). The citation is valid
 * when every cited statement is one the arm actually ran successfully, re-running it gives the same result the arm
 * saw, and every number the answer claims is in a re-run result (in one of its readings, within the support
 * tolerance). Undefined (not counted) for an answer that claims no number.
 */
export function citationValid(
  item: GoldenItem,
  answer: QuestionAnswer | undefined,
  ran: readonly { readonly sql: string; readonly rows?: readonly (readonly unknown[])[] }[],
  rerun: ReadonlyMap<string, readonly (readonly unknown[])[] | undefined>,
): boolean | undefined {
  if (!answer || answer.refused) return undefined;
  const nums = claimedNumbers(answer.answer, item.question);
  if (!nums.length) return undefined;
  const ok = ran.filter((q) => q.rows !== undefined);
  const cited = answer.sql?.length ? answer.sql.map((s) => s.trim()) : ok.map((q) => q.sql.trim());
  if (!cited.length) return false;
  const values: number[] = [];
  for (const sql of cited) {
    const seen = ok.find((q) => q.sql.trim() === sql);
    const again = rerun.get(sql);
    if (!seen || !again || JSON.stringify(again) !== JSON.stringify(seen.rows)) return false;
    values.push(...numericCells(again));
  }
  const tol = supportTolerance(item);
  return nums.every((n) => readings(n).some((v) => values.some((s) => withinTolerance(v, s, tol))));
}
