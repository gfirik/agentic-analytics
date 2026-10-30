// Entity matching (ingestion spec §7): link spellings of the same customer, supplier or product across
// columns and files. Exact match after normalization, else Jaro–Winkler ≥ 0.92 (DuckDB) plus token overlap.
import { type NormalizedTable, tableName, type Workspace } from "@agentic-analytics/store";
import { transliterate } from "./names.ts";
import { distinctValues, similarity as similarityOf, similarPairs } from "./profile.sql.ts";

export type EntityKind = "customer" | "supplier" | "product";

const KIND_BY_LABEL: readonly [RegExp, EntityKind][] = [
  [/supplier|vendor|поставщик|yetkazib/i, "supplier"],
  [/customer|client|buyer|account|клиент|покупатель|заказчик|контрагент|mijoz|xaridor/i, "customer"],
  [/product|item|sku|товар|продукт|номенклатура|mahsulot/i, "product"],
];

/** Legal-form tokens stripped before matching (spec §7: LLC, ООО, MChJ, Ltd, …), compared after transliteration. */
const LEGAL = new Set([
  "llc",
  "ltd",
  "inc",
  "corp",
  "co",
  "gmbh",
  "plc",
  "llp",
  "lp",
  "jsc",
  "ojsc",
  "cjsc",
  "pjsc",
  "ooo",
  "zao",
  "oao",
  "pao",
  "ao",
  "ip",
  "mchj",
  "xk",
  "aj",
  "qk",
  "sa",
  "ag",
  "bv",
  "nv",
  "company",
  "limited",
]);

export const MATCH_THRESHOLD = 0.92;
export const ASSUME_BELOW = 0.97;

export function entityKind(label: string): EntityKind | undefined {
  return KIND_BY_LABEL.find(([re]) => re.test(label))?.[1];
}

/** "ООО «Hotel Group»" → "hotel group". */
export function normalizeEntity(raw: string): string {
  return transliterate(raw)
    .toLowerCase()
    .replace(/[«»"'’‘`“”„]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t && !LEGAL.has(t))
    .join(" ")
    .trim();
}

/** One edit (insert, delete or substitute) apart: "bodrum" ~ "bodrun". */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Share of tokens the two names have in common; tokens of 4+ letters may differ by one typo. */
export function tokenOverlap(a: string, b: string): number {
  const A = [...new Set(a.split(" "))];
  const B = [...new Set(b.split(" "))];
  const same = (x: string, y: string) => x === y || (x.length >= 4 && y.length >= 4 && !/\d/.test(x + y) && oneEditApart(x, y));
  const shared = A.filter((x) => B.some((y) => same(x, y))).length;
  return shared / (A.length + B.length - shared);
}

/** Tokens with digits (sizes, models, codes: "1kg", "250g", "x10") must match exactly: they name different things. */
export function sameNumbers(a: string, b: string): boolean {
  const nums = (x: string) =>
    x
      .split(" ")
      .filter((t) => /\d/.test(t))
      .sort()
      .join(" ");
  return nums(a) === nums(b);
}

export interface EntityLink {
  readonly entity_id: string;
  readonly source_id: string;
  readonly column: string;
  readonly raw_value: string;
  readonly normalized: string;
  readonly confidence: number;
  readonly row_count: number;
}

export interface Entity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly canonical_name: string;
  readonly links: EntityLink[];
}

export async function matchEntities(ws: Workspace, tables: readonly NormalizedTable[]): Promise<Entity[]> {
  type Raw = { source_id: string; column: string; raw: string; n: number; normalized: string };
  const byKind = new Map<EntityKind, Raw[]>();
  for (const t of tables) {
    for (const c of t.columns) {
      const kind = entityKind(c.label);
      if (!kind || (c.type !== "category" && c.type !== "text")) continue;
      for (const v of await ws.all<{ raw: string; n: number }>(distinctValues(tableName(t.id), c.name))) {
        const normalized = normalizeEntity(v.raw);
        if (!normalized) continue;
        const raw = { source_id: t.id, column: c.name, raw: v.raw, n: v.n, normalized };
        const list = byKind.get(kind);
        if (list) list.push(raw);
        else byKind.set(kind, [raw]);
      }
    }
  }

  const entities: Entity[] = [];
  for (const [kind, raws] of byKind) {
    const names = [...new Set(raws.map((r) => r.normalized))].sort();
    // Union-find over normalized names: equal names are one group; similar names join after the overlap check.
    const parent = new Map(names.map((n) => [n, n]));
    const find = (x: string): string => {
      const p = parent.get(x) ?? x;
      if (p === x) return x;
      const root = find(p);
      parent.set(x, root);
      return root;
    };
    for (const pair of await ws.all<{ a: string; b: string; s: number }>(similarPairs(names, MATCH_THRESHOLD))) {
      if (tokenOverlap(pair.a, pair.b) < 0.5 || !sameNumbers(pair.a, pair.b)) continue;
      parent.set(find(pair.a), find(pair.b));
    }
    const groups = new Map<string, Raw[]>();
    for (const r of raws) {
      const root = find(r.normalized);
      const group = groups.get(root);
      if (group) group.push(r);
      else groups.set(root, [r]);
    }

    for (const members of [...groups.values()].sort((a, b) => (a[0]?.normalized ?? "").localeCompare(b[0]?.normalized ?? ""))) {
      // Canonical name: the most frequent raw spelling (ties: the longer, then alphabetical).
      const totals = new Map<string, number>();
      for (const m of members) totals.set(m.raw, (totals.get(m.raw) ?? 0) + m.n);
      const canonical =
        [...totals.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
      const canonicalNorm = normalizeEntity(canonical);
      const id = `E${entities.length + 1}`;
      // Confidence: 1 for the canonical spelling, 0.99 for the same normalized name, otherwise the Jaro–Winkler
      // similarity to the canonical name, computed directly (not inherited through other members).
      const links: EntityLink[] = [];
      for (const m of members) {
        const confidence =
          m.raw === canonical
            ? 1
            : m.normalized === canonicalNorm
              ? 0.99
              : ((await ws.one<{ s: number }>(similarityOf(m.normalized, canonicalNorm)))?.s ?? 0);
        links.push({
          entity_id: id,
          source_id: m.source_id,
          column: m.column,
          raw_value: m.raw,
          normalized: m.normalized,
          confidence,
          row_count: m.n,
        });
      }
      entities.push({ id, kind, canonical_name: canonical, links });
    }
  }
  // One appender per table, not a statement per row: a file with tens of thousands of item names has as many entities.
  await ws.append(
    "entities",
    entities.map((e) => [e.id, e.kind, e.canonical_name]),
  );
  await ws.append(
    "entity_links",
    entities.flatMap((e) => e.links.map((l) => [l.entity_id, l.source_id, l.column, l.raw_value, l.normalized, l.confidence, l.row_count])),
  );
  return entities;
}
