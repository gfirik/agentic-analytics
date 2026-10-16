// Entity matching (ingestion spec §7): link spellings of the same customer, supplier or product across
// columns and files. Exact match after normalization, else Jaro–Winkler ≥ 0.92 (DuckDB) plus token overlap.
import { type NormalizedTable, sql, tableName, type Workspace } from "@agentic-analytics/store";
import { transliterate } from "./names.ts";
import { distinctValues, similarPairs } from "./profile.sql.ts";

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

function tokenOverlap(a: string, b: string): number {
  const A = new Set(a.split(" "));
  const B = new Set(b.split(" "));
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / new Set([...A, ...B]).size;
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
        if (normalized)
          byKind.set(kind, [...(byKind.get(kind) ?? []), { source_id: t.id, column: c.name, raw: v.raw, n: v.n, normalized }]);
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
    const similarity = new Map<string, number>();
    for (const pair of await ws.all<{ a: string; b: string; s: number }>(similarPairs(names, MATCH_THRESHOLD))) {
      if (tokenOverlap(pair.a, pair.b) < 0.5 || !sameNumbers(pair.a, pair.b)) continue;
      similarity.set(`${pair.a}\u0000${pair.b}`, pair.s);
      parent.set(find(pair.a), find(pair.b));
    }
    const groups = new Map<string, Raw[]>();
    for (const r of raws) groups.set(find(r.normalized), [...(groups.get(find(r.normalized)) ?? []), r]);

    for (const members of [...groups.values()].sort((a, b) => (a[0]?.normalized ?? "").localeCompare(b[0]?.normalized ?? ""))) {
      // Canonical name: the most frequent raw spelling (ties: the longer, then alphabetical).
      const totals = new Map<string, number>();
      for (const m of members) totals.set(m.raw, (totals.get(m.raw) ?? 0) + m.n);
      const canonical =
        [...totals.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
      const canonicalNorm = normalizeEntity(canonical);
      const id = `E${entities.length + 1}`;
      const links = members.map((m): EntityLink => {
        const key = [m.normalized, canonicalNorm].sort().join("\u0000");
        const confidence = m.raw === canonical ? 1 : m.normalized === canonicalNorm ? 0.99 : (similarity.get(key) ?? MATCH_THRESHOLD);
        return {
          entity_id: id,
          source_id: m.source_id,
          column: m.column,
          raw_value: m.raw,
          normalized: m.normalized,
          confidence,
          row_count: m.n,
        };
      });
      entities.push({ id, kind, canonical_name: canonical, links });
    }
  }
  for (const e of entities) {
    await ws.run(sql`INSERT INTO entities VALUES (${e.id}, ${e.kind}, ${e.canonical_name})`);
    for (const l of e.links) {
      await ws.run(
        sql`INSERT INTO entity_links VALUES (${l.entity_id}, ${l.source_id}, ${l.column}, ${l.raw_value}, ${l.normalized}, ${l.confidence}, ${l.row_count})`,
      );
    }
  }
  return entities;
}
