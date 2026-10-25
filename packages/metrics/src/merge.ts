// Merging metric sets by definition (docs/specs/analysis-library.md §8.1 "Dedupe by definition", metric-layer §2 step 2):
// two metrics with the same type, table, expression, filters and time column are one metric. The code's KPI pack comes
// first, the model's draft after it, and a later duplicate is merged into the earlier one, so a bigger draft does not
// mean more metrics saying the same thing.
import type { MetricDef } from "@agentic-analytics/schema";
import type { Catalog } from "./catalog.ts";
import { parseExpression, parseFilter } from "./lang.ts";
import { canonical, termKey } from "./validate.ts";

export interface Merged {
  readonly accepted: MetricDef[];
  /** A metric that repeated an earlier one's definition: its id, the id kept, and the dimensions it added. */
  readonly merged: { readonly id: string; readonly into: string }[];
  /** A metric dropped because its id is taken by a different definition (or it builds on one that was). */
  readonly dropped: { readonly id: string; readonly reasons: string[] }[];
}

/** The identity of a definition: equal keys are the same metric, whatever they are called. */
export function definitionKey(def: MetricDef, byId: ReadonlyMap<string, MetricDef>, catalog: Catalog): string {
  if (def.type === "ratio") {
    const [n, d] = [def.numerator, def.denominator];
    return JSON.stringify(["ratio", n ? termKey(n, byId, catalog) : "", d ? termKey(d, byId, catalog) : "", def.unit]);
  }
  if (def.type === "derived") return JSON.stringify(["derived", canonical(def.expression ?? "", parseExpression)]);
  const filters = [...new Set((def.filters ?? []).map((f) => canonical(f, parseFilter)))].sort();
  const time = def.time_column ?? (def.table ? catalog.get(def.table)?.dateColumn : undefined);
  return JSON.stringify([def.type, def.table, canonical(def.expression ?? "", parseExpression), filters, time, def.cohort ?? null]);
}

/** The definition with its metric references renamed (a merged duplicate's id becomes the id kept). */
function renamed(def: MetricDef, rename: ReadonlyMap<string, string>): MetricDef {
  if (!rename.size) return def;
  if (def.type === "ratio") {
    const term = <T extends NonNullable<MetricDef["numerator"]>>(t: T | undefined) =>
      t && "metric" in t ? ({ metric: rename.get(t.metric) ?? t.metric } as T) : t;
    return {
      ...def,
      ...(def.numerator ? { numerator: term(def.numerator) } : {}),
      ...(def.denominator ? { denominator: term(def.denominator) } : {}),
    } as MetricDef;
  }
  if (def.type === "derived" && def.expression)
    return { ...def, expression: def.expression.replace(/[a-z][a-z0-9_]*/g, (w) => rename.get(w) ?? w) };
  return def;
}

/**
 * Merges metric sets in order of precedence (earlier sets win). Each set is already validated. A metric repeating an
 * earlier definition is merged into it: the earlier id stays and the later one's dimensions are added. A metric whose
 * id is taken by a different definition is dropped; metrics that refer to that id keep their reference, which now
 * means the earlier definition (a model's `revenue` and the pack's are the same idea; the dropped one is listed with
 * its reason so nothing is silent).
 */
export function mergeMetricSets(sets: readonly (readonly MetricDef[])[], catalog: Catalog): Merged {
  const kept = new Map<string, MetricDef>();
  const byKey = new Map<string, string>();
  const rename = new Map<string, string>();
  const merged: Merged["merged"][number][] = [];
  const dropped: Merged["dropped"][number][] = [];
  for (const raw of sets.flat()) {
    const def = renamed(raw, rename);
    const key = definitionKey(def, kept, catalog);
    const same = byKey.get(key);
    if (same) {
      const survivor = kept.get(same) as MetricDef;
      const dims = [...new Set([...(survivor.dimensions ?? []), ...(def.dimensions ?? [])])];
      kept.set(same, dims.length ? { ...survivor, dimensions: dims } : survivor);
      if (def.id !== same) {
        rename.set(def.id, same);
        merged.push({ id: def.id, into: same });
      }
      continue;
    }
    if (kept.has(def.id)) {
      dropped.push({ id: def.id, reasons: [`id "${def.id}" is already used by a different definition`] });
      continue;
    }
    kept.set(def.id, def);
    byKey.set(key, def.id);
  }
  return { accepted: [...kept.values()], merged, dropped };
}

/**
 * The slices among a metric set, by definition (analysis-library §6, the [M14a] gap): a metric is a slice of another
 * when both aggregate the same thing (type, table, expression, time column, cohort) and the other's filters are
 * fewer and all among its own. Returns slice id to the id of its root, so ranking groups `wholesale_revenue` with
 * `revenue` because of what they sum, not because of how an id ends.
 */
export function sliceParents(defs: readonly MetricDef[]): Map<string, string> {
  const filters = (d: MetricDef) => new Set((d.filters ?? []).map((f) => canonical(f, parseFilter)));
  const same = (d: MetricDef) =>
    JSON.stringify([d.type, d.table, canonical(d.expression ?? "", parseExpression), d.time_column ?? null, d.cohort ?? null]);
  const out = new Map<string, string>();
  for (const d of defs) {
    if (d.type === "ratio" || d.type === "derived") continue;
    const mine = filters(d);
    const roots = defs
      .filter((p) => p.id !== d.id && p.type === d.type && same(p) === same(d))
      .map((p) => ({ p, f: filters(p) }))
      .filter(({ f }) => f.size < mine.size && [...f].every((x) => mine.has(x)))
      .sort((a, b) => a.f.size - b.f.size);
    const root = roots[0];
    if (root) out.set(d.id, root.p.id);
  }
  return out;
}
