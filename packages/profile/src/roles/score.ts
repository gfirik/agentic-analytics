// The role detector's per-column scoring (docs/specs/semantics.md §2.1): pure functions of one column's header, type
// and profile statistics. Cross-column identities are added by detect.ts. Same input, same candidates.
import type { ColumnType } from "@agentic-analytics/store";
import { headerTokens, stemTokens } from "./header.ts";
import { ID_OF, ID_SUFFIXES, SYNONYMS } from "./synonyms.ts";
import { type Role, roleOrder } from "./vocabulary.ts";

/** Weights as built (semantics.md §2.1). */
export const WEIGHTS = {
  /** The whole header is a synonym. */
  nameExact: 0.5,
  /** The header ends with a synonym (the head word of a compound: `distribution channel`). */
  nameEnds: 0.35,
  /** A synonym sits inside the header but is not its head (`customer type` is a type, not a customer). */
  nameInside: 0.15,
  /** The column's type is one the role admits. */
  type: 0.1,
  /** Value pattern for a role that has name evidence. */
  value: 0.2,
  /** Value pattern that stands alone: a varying number is a measure, a varying category a dimension. */
  residual: 0.3,
  /** A cross-column identity holds. */
  identity: 0.3,
} as const;

/** A column's top candidate is its proposal when its score reaches this. */
export const PROPOSE_AT = 0.4;
/** Whole-number columns with at most this many distinct values (and at most 1% of rows) look like codes. */
export const CODE_LIKE_DISTINCT = 50;
/** A constant (or all-distinct integer) column is a technical column only over this many rows: a flat monthly rent over two years proves nothing. */
export const CONSTANT_MIN_ROWS = 100;

/** What the detector reads of a column: the existing profile, and nothing else. */
export interface RoleColumn {
  readonly name: string;
  readonly label: string;
  readonly type: ColumnType;
  readonly currency?: string;
  readonly position: number;
  /** Detail rows of the table. */
  readonly rows: number;
  readonly non_null: number;
  readonly distinct: number;
  readonly min: string | null;
  readonly max: string | null;
  /** The most frequent values (at most five), as text. */
  readonly top: readonly string[];
}

export type EvidenceSignal = "name" | "type" | "value" | "identity" | "model";

export interface Evidence {
  readonly signal: EvidenceSignal;
  readonly text: string;
  readonly weight: number;
}

export interface RoleCandidate {
  readonly role: Role;
  /** Sum of the evidence weights, capped at 1. */
  readonly score: number;
  readonly evidence: readonly Evidence[];
}

const TEXTUAL: readonly ColumnType[] = ["category", "text"];
const CODE: readonly ColumnType[] = ["id", "integer", "text", "category"];
const MONEY: readonly ColumnType[] = ["currency", "decimal", "integer"];
const DATES: readonly ColumnType[] = ["date", "datetime"];

const TYPES: Partial<Record<Role, readonly ColumnType[]>> = {
  transaction_date: DATES,
  issue_date: DATES,
  due_date: DATES,
  paid_date: DATES,
  snapshot_date: DATES,
  // A part of a date (a year, a month name) is not a period label; a month typed as a date or a text label is.
  period: ["date", "datetime", "text"],
  order_id: CODE,
  invoice_id: CODE,
  line_id: CODE,
  customer_id: CODE,
  product_id: CODE,
  supplier_id: CODE,
  customer: TEXTUAL,
  product: TEXTUAL,
  supplier: TEXTUAL,
  location: TEXTUAL,
  salesperson: [...TEXTUAL, "id", "integer"],
  product_group: ["category"],
  channel: ["category"],
  dimension: ["category"],
  amount: MONEY,
  unit_price: MONEY,
  unit_cost: MONEY,
  cost_amount: MONEY,
  discount: MONEY,
  tax: MONEY,
  refund_amount: MONEY,
  paid_amount: MONEY,
  balance: MONEY,
  quantity: ["integer", "decimal"],
  stock_on_hand: ["integer", "decimal"],
  count: ["integer"],
  measure: ["integer", "decimal", "currency", "percent"],
  status: [...TEXTUAL, "boolean", "integer"],
  currency: TEXTUAL,
  description: TEXTUAL,
};

const NUMERIC: readonly ColumnType[] = ["integer", "decimal", "currency", "percent"];
export const isNumeric = (t: ColumnType): boolean => NUMERIC.includes(t);
export const isDateType = (t: ColumnType): boolean => DATES.includes(t);

/** Whether the role admits the column's type (§2.1 "Type" gate); a status stored as a number must have few values. */
export function admits(role: Role, c: RoleColumn): boolean {
  if (!TYPES[role]?.includes(c.type)) return false;
  if (role === "status" && c.type === "integer") return c.distinct <= 10;
  return true;
}

/** Whole numbers with few distinct values look like a code, not a quantity (§2.1 "Value pattern"). */
export const codeLike = (c: RoleColumn): boolean => c.distinct <= CODE_LIKE_DISTINCT && c.distinct * 100 <= c.rows;

interface NameHit {
  readonly weight: number;
  readonly text: string;
}

/** How a header relates to a role's phrases: the whole header, its last words, or words inside it. */
function matchPhrases(stem: readonly string[], phrases: readonly string[], via?: string): NameHit | undefined {
  let best: NameHit | undefined;
  const joined = ` ${stem.join(" ")} `;
  for (const p of phrases) {
    const n = p.split(" ").length;
    let weight = 0;
    let how = "";
    if (stem.length === n && stem.join(" ") === p) [weight, how] = [WEIGHTS.nameExact, "is"];
    else if (stem.length > n && stem.slice(stem.length - n).join(" ") === p) [weight, how] = [WEIGHTS.nameEnds, "ends with"];
    else if (joined.includes(` ${p} `)) [weight, how] = [WEIGHTS.nameInside, "contains"];
    if (weight > (best?.weight ?? 0)) best = { weight, text: `header ${how} "${p}"${via ?? ""}` };
  }
  return best;
}

/** The name signal of one role for a header (§2.1, §2.3), including `<entity> id` and `<entity> code` forms. */
export function nameHit(role: Role, c: RoleColumn): NameHit | undefined {
  const stem = stemTokens(headerTokens(c.label));
  const own = SYNONYMS.get(role) ?? [];
  let best = matchPhrases(stem, own);
  const last = stem[stem.length - 1] ?? "";
  const idOnly = stem.length > 1 && ID_SUFFIXES.has(last);
  const idSource = Object.entries(ID_OF).find(([, idRole]) => idRole === role)?.[0] as Role | undefined;
  // `customer id` is the customer entity's code. A bare `customer` held as numbers is its code too.
  if (idSource && (idOnly || c.type === "id" || c.type === "integer")) {
    const base = idOnly ? stem.slice(0, -1) : stem;
    const viaName = matchPhrases(base, SYNONYMS.get(idSource) ?? [], ` (${idOnly ? "id suffix" : "numeric code"})`);
    if (viaName && viaName.weight > (best?.weight ?? 0)) best = viaName;
  }
  // The other id roles (`order no`, `invoice number`) are their own words plus an optional suffix.
  if (role === "order_id" || role === "invoice_id" || role === "line_id") {
    if (idOnly) {
      const viaWord = matchPhrases(stem.slice(0, -1), own, " (id suffix)");
      if (viaWord && viaWord.weight > (best?.weight ?? 0)) best = viaWord;
    }
  }
  // An entity's name role does not claim a header that says "id" or "code": that is the id role's.
  if (idOnly && ID_OF[role] && best) best = undefined;
  return best;
}

const sum = (e: readonly Evidence[]) =>
  Math.min(
    1,
    e.reduce((s, x) => s + x.weight, 0),
  );

/**
 * Every candidate role of one column with its score and evidence (§2.1). A column that is empty, or constant over
 * enough rows, has none. A candidate needs name or value evidence: the type gate alone adds nothing.
 */
export function columnCandidates(c: RoleColumn): RoleCandidate[] {
  if (c.non_null === 0) return [];
  if (c.distinct <= 1 && c.non_null >= CONSTANT_MIN_ROWS) return [];
  const out: RoleCandidate[] = [];
  const add = (role: Role, evidence: Evidence[]) => {
    if (evidence.length === 0) return;
    if (!evidence.some((e) => e.signal === "type")) evidence.push({ signal: "type", text: `type ${c.type} fits`, weight: WEIGHTS.type });
    out.push({ role, score: sum(evidence), evidence });
  };

  for (const role of TYPES_ROLES) {
    if (!admits(role, c)) continue;
    const hit = nameHit(role, c);
    const evidence: Evidence[] = [];
    if (hit) evidence.push({ signal: "name", text: hit.text, weight: hit.weight });
    if (hit && role === "quantity" && !codeLike(c))
      evidence.push({ signal: "value", text: "whole numbers or decimals with many distinct values", weight: WEIGHTS.value });
    if (hit && role === "status" && c.distinct <= 10)
      evidence.push({ signal: "value", text: `${c.distinct} distinct values`, weight: WEIGHTS.value });
    if (hit && role === "currency" && c.top.length > 0 && c.top.every((v) => /^[A-Z]{3}$/.test(v)))
      evidence.push({ signal: "value", text: "values are three-letter codes", weight: WEIGHTS.value });
    add(role, evidence);
  }

  // Residual roles: a varying number nothing else explains is a measure; a varying category a dimension.
  const stem = stemTokens(headerTokens(c.label));
  const idShaped = stem.length > 0 && ID_SUFFIXES.has(stem[stem.length - 1] ?? "") && stem.length > 1;
  // Like constancy, uniqueness says "key" only over enough rows: twelve distinct monthly costs are not an index.
  const unique = c.type === "integer" && c.distinct === c.non_null && c.non_null >= CONSTANT_MIN_ROWS;
  if (!idShaped && !unique) {
    if (isNumeric(c.type) && !out.some((x) => x.role === "measure"))
      add("measure", [{ signal: "value", text: "a numeric column that varies", weight: WEIGHTS.residual }]);
    if (c.type === "category" && !out.some((x) => x.role === "dimension"))
      add("dimension", [{ signal: "value", text: "a category column that varies", weight: WEIGHTS.residual }]);
  }
  return rank(out);
}

/** Roles that can carry a name signal, in vocabulary order. */
const TYPES_ROLES = (Object.keys(TYPES) as Role[]).sort((a, b) => roleOrder(a) - roleOrder(b));

/** Score descending, then the role's order in the vocabulary (§2.1). */
export function rank(cs: readonly RoleCandidate[]): RoleCandidate[] {
  return [...cs].sort((a, b) => b.score - a.score || roleOrder(a.role) - roleOrder(b.role));
}

/** Adds evidence to a column's candidate list (creating the candidate), and returns the re-ranked list. */
export function withEvidence(cs: readonly RoleCandidate[], role: Role, e: Evidence, c: RoleColumn): RoleCandidate[] {
  const found = cs.find((x) => x.role === role);
  if (found) {
    const evidence = [...found.evidence, e];
    return rank(cs.map((x) => (x === found ? { role, score: sum(evidence), evidence } : x)));
  }
  if (!admits(role, c)) return [...cs];
  const evidence: Evidence[] = [e, { signal: "type", text: `type ${c.type} fits`, weight: WEIGHTS.type }];
  return rank([...cs, { role, score: sum(evidence), evidence }]);
}
