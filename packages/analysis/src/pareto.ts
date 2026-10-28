// Pareto classes, top-N shares and HHI over a dimension's member totals (analysis-library §11). Pure and deterministic:
// the report's facts come from the SQL templates (`pareto.sql.ts`, `concentration.sql.ts`); these functions are the
// second path that V2 recomputes them with (rules `pareto_class`, `top_n_share`, `hhi`) and that DETECT decides with.
import { hhi } from "./stats.ts";

/** A dimension member and its metric value over a window; `key` is null for rows that have no key. */
export interface Member {
  readonly key: string | null;
  readonly total: number;
}

/** Cumulative-share cut-offs of the classes: A up to `a`, B up to `b`, C beyond (§11.1). */
export interface ParetoCuts {
  readonly a: number;
  readonly b: number;
}
export const PARETO_CUTS: ParetoCuts = { a: 80, b: 95 };
/** A member that reaches a cut-off exactly lands on the lower class despite floating-point rounding (§11.1). */
export const CUT_TOLERANCE = 1e-12;

export const CLASSES = ["a", "b", "c"] as const;
export type ParetoClass = (typeof CLASSES)[number];
export type ParetoPart =
  | `${ParetoClass}_${"count" | "value" | "share"}`
  | "members"
  | "nonpositive_count"
  | "nonpositive_value"
  | "unkeyed_value";
export const TOP_NS = [1, 3, 5, 10] as const;
export type TopN = (typeof TOP_NS)[number];
export type ConcentrationPart = `top${TopN}_share` | "hhi";
export type StatPart = ParetoPart | ConcentrationPart;

export const PARETO_PARTS: readonly ParetoPart[] = [
  ...CLASSES.flatMap((c) => [`${c}_count`, `${c}_value`, `${c}_share`] as const),
  "members",
  "nonpositive_count",
  "nonpositive_value",
  "unkeyed_value",
];
export const CONCENTRATION_PARTS: readonly ConcentrationPart[] = [...TOP_NS.map((n) => `top${n}_share` as const), "hhi"];

// Ties by key in code-unit order, which is the SQL template's ORDER BY (binary collation).
const byValue = (a: Member, b: Member) => b.total - a.total || ((a.key ?? "") < (b.key ?? "") ? -1 : (a.key ?? "") > (b.key ?? "") ? 1 : 0);

/** The positive keyed members, largest first (ties by key), and what was left out of the curve. */
export function curve(members: readonly Member[]): {
  readonly positive: readonly Member[];
  readonly total: number;
  readonly nonpositive: { readonly count: number; readonly value: number };
  readonly unkeyed: number;
} {
  const keyed = members.filter((m) => m.key !== null);
  const positive = keyed.filter((m) => m.total > 0).sort(byValue);
  const nonpositive = keyed.filter((m) => m.total <= 0);
  return {
    positive,
    total: positive.reduce((a, m) => a + m.total, 0),
    nonpositive: { count: nonpositive.length, value: nonpositive.reduce((a, m) => a + m.total, 0) },
    unkeyed: members.filter((m) => m.key === null).reduce((a, m) => a + m.total, 0),
  };
}

/** The class of each positive member, in curve order: the class its cumulative share reaches (§11.1). */
export function classes(positive: readonly Member[], total: number, cuts: ParetoCuts = PARETO_CUTS): ParetoClass[] {
  let cum = 0;
  return positive.map((m, i) => {
    cum += m.total;
    const within = (cut: number) => cum * 100 <= cut * total * (1 + CUT_TOLERANCE);
    return i === 0 || within(cuts.a) ? "a" : within(cuts.b) ? "b" : "c";
  });
}

type Curve = ReturnType<typeof curve>;

/** The value of one stat over the members, or undefined when it is not stated (top-N with N or fewer members). */
export function statValue(part: StatPart, members: readonly Member[], cuts: ParetoCuts = PARETO_CUTS): number | undefined {
  return statOf(part, curve(members), cuts);
}

function statOf(
  part: StatPart,
  c: Curve,
  cuts: ParetoCuts,
  cls: () => ParetoClass[] = () => classes(c.positive, c.total, cuts),
): number | undefined {
  switch (part) {
    case "members":
      return c.positive.length;
    case "nonpositive_count":
      return c.nonpositive.count;
    case "nonpositive_value":
      return c.nonpositive.value;
    case "unkeyed_value":
      return c.unkeyed;
    case "hhi":
      return c.total > 0 ? hhi(c.positive.map((m) => m.total / c.total)) : undefined;
    case "top1_share":
    case "top3_share":
    case "top5_share":
    case "top10_share": {
      const n = Number(part.slice(3, part.indexOf("_")));
      // Trivially 100% with N or fewer members, so not stated; the top member alone is stated from one member.
      if (c.total <= 0 || (n > 1 ? c.positive.length <= n : c.positive.length < 1)) return undefined;
      return (c.positive.slice(0, n).reduce((a, m) => a + m.total, 0) / c.total) * 100;
    }
    default: {
      const of = cls();
      const own = c.positive.filter((_, i) => of[i] === part[0]);
      const value = own.reduce((a, m) => a + m.total, 0);
      if (part.endsWith("_count")) return own.length;
      if (part.endsWith("_value")) return value;
      return c.total > 0 ? (value / c.total) * 100 : undefined;
    }
  }
}

/** Every stat that is stated over `members`. */
export function allStats(members: readonly Member[], cuts: ParetoCuts = PARETO_CUTS): Map<StatPart, number> {
  const out = new Map<StatPart, number>();
  const c = curve(members);
  let memo: ParetoClass[] | undefined;
  const cls = () => (memo ??= classes(c.positive, c.total, cuts));
  for (const part of [...PARETO_PARTS, ...CONCENTRATION_PARTS]) {
    const v = statOf(part, c, cuts, cls);
    if (v !== undefined) out.set(part, v);
  }
  return out;
}
