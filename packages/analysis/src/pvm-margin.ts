// Margin price–volume–mix (pvm_margin.v1, docs/specs/analysis-library.md §10): pvm.v1 for margin, with one more effect
// for unit cost. Pure: items in, calcs out; the runner records each calc as a fact with its inputs (AGENTS.md §2.1).
import { commonEffects } from "./pvm-kernel.ts";
import { type Calc, calcRef, type Ref, type Unit } from "./types.ts";

export interface MarginItem {
  readonly key: string;
  /** Revenue, quantity and cost per period; 0 when the item has no line there (absent items are not "present"). */
  readonly r0: number;
  readonly q0: number;
  readonly cost0: number;
  readonly r1: number;
  readonly q1: number;
  readonly cost1: number;
  /** Refs of the measured points, for provenance. */
  readonly refs: { readonly [K in "r0" | "q0" | "cost0" | "r1" | "q1" | "cost1"]?: Ref };
}

export interface PvmMargin {
  readonly method: "pvm_margin.v1";
  readonly volume: Calc;
  readonly mix: Calc;
  readonly price: Calc;
  readonly cost: Calc;
  readonly newItems: Calc;
  readonly lostItems: Calc;
  readonly unpriced: Calc;
  /** The effects that apply (their item group is non-empty); `total` sums exactly these. */
  readonly parts: readonly Calc[];
  readonly total: Calc;
  /** Items in each group, for the reader and the tests. */
  readonly groups: {
    readonly common: readonly string[];
    readonly new: readonly string[];
    readonly lost: readonly string[];
    readonly unpriced: readonly string[];
  };
}

type Key = "r0" | "q0" | "cost0" | "r1" | "q1" | "cost1";

/** An item is present in a period when its revenue or its cost there is non-zero (§10). */
const present0 = (i: MarginItem) => i.r0 !== 0 || i.cost0 !== 0;
const present1 = (i: MarginItem) => i.r1 !== 0 || i.cost1 !== 0;

/** Groups of six (r₀, q₀, cost₀, r₁, q₁, cost₁), the order V2 reads them in. */
export const COMMON_KEYS: readonly Key[] = ["r0", "q0", "cost0", "r1", "q1", "cost1"];
const UNPRICED_KEYS: readonly Key[] = ["r0", "cost0", "r1", "cost1"];

export type MarginEffect = "volume" | "mix" | "price" | "cost" | "new" | "lost" | "unpriced";

const groupsOf = (xs: readonly number[], n: number) =>
  Array.from({ length: Math.floor(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/**
 * One effect from its inputs, in the order its calc lists them: groups of six for volume, mix, price and cost, pairs
 * (revenue, cost) for new and lost, groups of four for unpriced (§10). The single formula both the analysis and V2 use.
 */
export function marginEffect(effect: MarginEffect, x: readonly number[]): number {
  const n = (v: number | undefined) => v ?? Number.NaN;
  // Fail closed: inputs that do not fill whole groups (or none at all) have no value, so V2 cannot match a stored one.
  const size = effect === "new" || effect === "lost" ? 2 : effect === "unpriced" ? 4 : 6;
  if (x.length === 0 || x.length % size !== 0) return Number.NaN;
  if (effect === "new") return groupsOf(x, 2).reduce((s, g) => s + n(g[0]) - n(g[1]), 0);
  if (effect === "lost") return -groupsOf(x, 2).reduce((s, g) => s + n(g[0]) - n(g[1]), 0);
  if (effect === "unpriced") return groupsOf(x, 4).reduce((s, g) => s + (n(g[2]) - n(g[3])) - (n(g[0]) - n(g[1])), 0);
  const e = commonEffects(
    groupsOf(x, 6).map((g) => ({
      q0: n(g[1]),
      q1: n(g[4]),
      p0: n(g[0]) / n(g[1]),
      p1: n(g[3]) / n(g[4]),
      c0: n(g[2]) / n(g[1]),
      c1: n(g[5]) / n(g[4]),
    })),
  );
  return e[effect];
}

/**
 * @param period the later period; it ends the fixed fact labels (`pvm_margin.cost_<period>`, spec §14)
 */
export function pvmMargin(items: readonly MarginItem[], period: string, unit: Unit = "currency"): PvmMargin {
  const both = items.filter((i) => present0(i) && present1(i));
  const common = both.filter((i) => i.q0 !== 0 && i.q1 !== 0);
  const unpricedItems = both.filter((i) => i.q0 === 0 || i.q1 === 0);
  const onlyNew = items.filter((i) => present1(i) && !present0(i));
  const onlyLost = items.filter((i) => present0(i) && !present1(i));
  const refsOf = (list: readonly MarginItem[], keys: readonly Key[]): Ref[] =>
    list.flatMap((i) => keys.map((k) => i.refs[k]).filter((r): r is Ref => r !== undefined));
  // The value comes from the item numbers in the order of the refs, through the formula V2 recomputes with.
  const calc = (effect: MarginEffect, label: string, list: readonly MarginItem[], keys: readonly Key[]): Calc => {
    const value = marginEffect(
      effect,
      list.flatMap((i) => keys.map((k) => i[k])),
    );
    return {
      name: `pvm_margin:${effect}`,
      label,
      // 0 − x style sums can yield −0; a fact never shows "-0".
      value: value === 0 ? 0 : value,
      unit,
      fn: "pvm_margin.v1",
      inputs: refsOf(list, keys),
      factLabel: `pvm_margin.${effect}_${period}`,
    };
  };
  const volume = calc("volume", "volume effect on margin", common, COMMON_KEYS);
  const mix = calc("mix", "mix effect on margin", common, COMMON_KEYS);
  const price = calc("price", "price effect on margin", common, COMMON_KEYS);
  const cost = calc("cost", "unit cost effect on margin", common, COMMON_KEYS);
  const newItems = calc("new", "margin of new items", onlyNew, ["r1", "cost1"]);
  const lostItems = calc("lost", "margin of lost items", onlyLost, ["r0", "cost0"]);
  const unpriced = calc("unpriced", "margin change of items without quantity", unpricedItems, UNPRICED_KEYS);
  // Effects whose item group is empty would be 0 with nothing to cite (AGENTS.md §2.2), so they are left out.
  const parts = [
    ...(common.length ? [volume, mix, price, cost] : []),
    ...(onlyNew.length ? [newItems] : []),
    ...(onlyLost.length ? [lostItems] : []),
    ...(unpricedItems.length ? [unpriced] : []),
  ];
  const total: Calc = {
    name: "pvm_margin:total",
    label: "total change in margin",
    value: parts.reduce((s, c) => s + c.value, 0),
    unit,
    fn: "sum",
    inputs: parts.map((c) => calcRef(c.name)),
  };
  return {
    method: "pvm_margin.v1",
    volume,
    mix,
    price,
    cost,
    newItems,
    lostItems,
    unpriced,
    parts,
    total,
    groups: {
      common: common.map((i) => i.key),
      new: onlyNew.map((i) => i.key),
      lost: onlyLost.map((i) => i.key),
      unpriced: unpricedItems.map((i) => i.key),
    },
  };
}
