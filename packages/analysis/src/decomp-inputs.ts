// The inputs of the decompositions, read through the metric layer (analysis-library §4.2, §4.3, §10): quantities and costs
// per item for price–volume–mix, and numerator/denominator segments for rate vs mix. Everything is SQL via runMetric; the
// pure functions in decompose.ts and pvm-margin.ts only combine what is read here.
import { type Catalog, type Grain, type MarginTerms, runMetric } from "@agentic-analytics/metrics";
import type { MetricDef } from "@agentic-analytics/schema";
import type { Workspace } from "@agentic-analytics/store";
import { type Pvm, type PvmItem, pvm, type RateMix, rateMix } from "./decompose.ts";
import type { SeriesInfo } from "./factbook.ts";
import { memberFilter } from "./members.ts";
import { type MarginItem, type PvmMargin, pvmMargin } from "./pvm-margin.ts";
import { columnsWithRole, tableRoles } from "./roles.sql.ts";
import { OTHER, point, type Series } from "./types.ts";

export const valueAt = (s: Series, period: string): number => s.points.find((p) => p.period === period)?.value ?? 0;

/**
 * The roles PVM reads (semantics §1, M15): the units column has role `quantity`, and the dimension is an item, so it has
 * a product role. They replace header regexes; the roles are the detector's proposals or the user's confirmation, stored
 * next to the profile (`profile_roles`).
 */
export const ITEM_ROLES = ["product", "product_id", "product_group"] as const;

/** The numeric quantity column of a table (role `quantity`), best score first. */
async function quantityColumn(ws: Workspace, table: NonNullable<ReturnType<Catalog["get"]>>) {
  return (await columnsWithRole(ws, table.id, ["quantity"]))
    .map((name) => table.columns.get(name))
    .find((c) => c && (c.type === "integer" || c.type === "decimal"));
}

/** What PVM needs of a metric (§4.2, §13): a sum, a quantity column on its table, and an item among its dimensions. */
export async function pvmReadiness(
  ws: Workspace,
  catalog: Catalog,
  def: MetricDef,
): Promise<{ readonly sum: boolean; readonly quantity: boolean; readonly item: boolean }> {
  const table = catalog.get(def.table ?? "");
  if (def.type !== "sum" || !table) return { sum: false, quantity: false, item: false };
  const items = await columnsWithRole(ws, table.id, ITEM_ROLES);
  return {
    sum: true,
    quantity: (await quantityColumn(ws, table)) !== undefined,
    item: (def.dimensions ?? []).some((d) => items.includes(d)),
  };
}

/**
 * PVM (spec §4.2) when the metric is a sum over a table with a quantity column and the dimension names items.
 * Quantity per item comes from the same SQL path: a sum of the quantity column with the metric's filters.
 */
export async function pvmFor(
  ws: Workspace,
  defs: readonly MetricDef[],
  register: (d: MetricDef) => void,
  catalog: Catalog,
  def: MetricDef,
  dimension: string,
  items: readonly Series[],
  before: string,
  after: string,
  range: { from: string; to: string; grain: Grain },
  series: Map<string, SeriesInfo>,
): Promise<Pvm | undefined> {
  const table = catalog.get(def.table ?? "");
  const dimCol = table?.columns.get(dimension);
  if (def.type !== "sum" || !table || !dimCol) return undefined;
  if (!(await columnsWithRole(ws, table.id, ITEM_ROLES)).includes(dimension)) return undefined;
  const qtyCol = await quantityColumn(ws, table);
  if (!qtyCol) return undefined;
  // An "(other)" bucket mixes many items, so it has no unit price; contribution.v1 still covers this dimension.
  if (items.some((m) => m.member?.value === OTHER)) return undefined;
  // The quantity metric is registered with the runner's defs so the fact book can compile its points.
  const qtyDef: MetricDef = {
    ...def,
    id: `${def.id}__qty`,
    label: `${def.label} quantity`,
    expression: qtyCol.name,
    unit: "count",
    dimensions: [dimension],
  };
  register(qtyDef);
  const rows = await runMetric(ws, qtyDef.id, defs, catalog, { ...range, groupBy: [dimension] });
  const pvmItems: PvmItem[] = items.map((m) => {
    const key = m.member?.value ?? null;
    const qty = (p: string) => Number(rows.find((r) => r.period === p && (r[dimension] ?? null) === key)?.value ?? 0);
    const qSeries: Series = {
      id: `${qtyDef.id}|${dimension}=${key ?? "(none)"}`,
      metric: qtyDef.id,
      unit: "count",
      member: { dimension, value: key },
      // Every period of the range, not just this pair: the same series id is reused by other decompositions,
      // and a point missing here would become a 0-valued fact for them.
      points: allPeriods(rows, before, after).map((p) => ({ period: p, value: qty(p) })),
    };
    series.set(qSeries.id, { series: qSeries, def: qtyDef, where: memberFilter(dimension, key) });
    const r0 = valueAt(m, before);
    const r1 = valueAt(m, after);
    return {
      key: String(key),
      ...(r0 ? { r0, q0: qty(before) } : {}),
      ...(r1 ? { r1, q1: qty(after) } : {}),
      refs: {
        ...(r0 ? { r0: point(m.id, before), q0: point(qSeries.id, before) } : {}),
        ...(r1 ? { r1: point(m.id, after), q1: point(qSeries.id, after) } : {}),
      },
    };
  });
  return pvm(pvmItems);
}

/** Rate vs mix (spec §4.3) for a ratio metric over the first dimension of its denominator metric. */
export async function rateMixFor(
  ws: Workspace,
  defs: readonly MetricDef[],
  register: (d: MetricDef) => void,
  catalog: Catalog,
  def: MetricDef,
  before: string,
  after: string,
  range: { from: string; to: string; grain: Grain },
  series: Map<string, SeriesInfo>,
): Promise<{ dimension: string; result: RateMix } | undefined> {
  const num = def.numerator as { metric: string } | { table: string; expression: string; filters?: string[] } | undefined;
  const den = def.denominator as { metric: string } | { table: string; expression: string; filters?: string[] } | undefined;
  if (!num || !den) return undefined;
  const asDef = (t: typeof num, suffix: string): MetricDef | undefined =>
    "metric" in t
      ? defs.find((d) => d.id === t.metric)
      : {
          id: `${def.id}__${suffix}`,
          label: `${def.label} ${suffix}`,
          type: "sum",
          table: t.table,
          expression: t.expression,
          ...(t.filters ? { filters: t.filters } : {}),
          unit: "other",
          status: def.status,
        };
  const n = asDef(num, "num");
  const d = asDef(den, "den");
  const dimension = (d?.dimensions ?? [])[0];
  // Both sides must be sums over one table: a derived or ratio side (gross_margin) has no table to group by, and the
  // split by member needs additive terms.
  const additive = (m: MetricDef) => m.type !== "derived" && m.type !== "ratio";
  if (!n || !d || !dimension || n.table !== d.table || !additive(n) || !additive(d)) return undefined;
  register(n);
  register(d);
  const by = async (m: MetricDef) => runMetric(ws, m.id, defs, catalog, { ...range, groupBy: [dimension] });
  const [nRows, dRows] = [await by(n), await by(d)];
  const keys = [...new Set([...nRows, ...dRows].map((r) => (r[dimension] as string | null) ?? null))];
  const v = (rows: typeof nRows, key: string | null, p: string) =>
    Number(rows.find((r) => r.period === p && ((r[dimension] as string | null) ?? null) === key)?.value ?? 0);
  // Each segment's numerator and denominator become measured points, so the mix and rate facts cite them.
  const segmentSeries = (m: MetricDef, rows: typeof nRows, key: string | null): Series => {
    const s: Series = {
      // Own id namespace: never overwrite the member series measured for the dimension analysis.
      id: `ratemix:${m.id}|${dimension}=${key ?? "(none)"}`,
      metric: m.id,
      unit: "other",
      member: { dimension, value: key },
      // Every period (see pvmFor): a later decomposition over other periods reuses this series id.
      points: allPeriods([...nRows, ...dRows], before, after).map((p) => ({ period: p, value: v(rows, key, p) })),
    };
    series.set(s.id, { series: s, def: m, where: memberFilter(dimension, key) });
    return s;
  };
  const segments = keys.map((key) => {
    const ns = segmentSeries(n, nRows, key);
    const ds = segmentSeries(d, dRows, key);
    return {
      key: String(key),
      num0: v(nRows, key, before),
      den0: v(dRows, key, before),
      num1: v(nRows, key, after),
      den1: v(dRows, key, after),
      refs: [point(ns.id, before), point(ds.id, before), point(ns.id, after), point(ds.id, after)],
    };
  });
  const percent = def.unit === "percent";
  return { dimension, result: rateMix(segments, percent ? "percent" : "ratio", percent ? 100 : 1) };
}

/** The sorted periods of grouped metric rows, always including the pair being decomposed. */
export function allPeriods(rows: readonly { period: string }[], before: string, after: string): string[] {
  return [...new Set([...rows.map((r) => r.period), before, after])].sort();
}

/** The helper metric that counts units over the margin's lines; its facts are labelled `gross_margin__qty[…]`. */
const MARGIN_QTY = "gross_margin__qty";
const ITEM_PREFERENCE = ["product_id", "product", "product_group"] as const;

/**
 * Margin PVM (spec §10) for a margin metric whose table has a quantity role, an item dimension and a cost: revenue, quantity
 * and cost per item and period, all read through the metric layer. The revenue term is `revenue`, or `costed_revenue` when
 * some lines have no cost, so an item's margin is its revenue term minus its cost. Undefined (not run) when there is no
 * quantity role or item dimension, when the items include an "(other)" bucket (it has no unit price), or when the items'
 * margins do not add up to the margin metric's own change, which would mean the item set is incomplete.
 */
export async function pvmMarginFor(
  ws: Workspace,
  defs: readonly MetricDef[],
  register: (d: MetricDef) => void,
  catalog: Catalog,
  terms: MarginTerms,
  items: readonly Series[],
  margin: Series,
  dimension: string,
  before: string,
  after: string,
  range: { from: string; to: string; grain: Grain },
  series: Map<string, SeriesInfo>,
): Promise<PvmMargin | undefined> {
  const revenueDef = defs.find((d) => d.id === terms.revenue);
  const costDef = defs.find((d) => d.id === terms.cost);
  const table = catalog.get(revenueDef?.table ?? "");
  // One table: the unit price and unit cost of an item divide by the same units, and the item column must be in it.
  if (!revenueDef || !costDef || !table || costDef.table !== revenueDef.table || !table.columns.has(dimension)) return undefined;
  if (items.some((m) => m.member?.value === OTHER)) return undefined;
  const qtyCol = await quantityColumn(ws, table);
  if (!qtyCol) return undefined;
  // Quantity over the same lines as the revenue term, so unit price and unit cost divide by the same units.
  const qtyDef: MetricDef = {
    ...revenueDef,
    id: MARGIN_QTY,
    label: "Gross margin quantity",
    expression: qtyCol.name,
    unit: "count",
    dimensions: [dimension],
  };
  register(qtyDef);
  const [qtyRows, costRows] = await Promise.all([
    runMetric(ws, qtyDef.id, defs, catalog, { ...range, groupBy: [dimension] }),
    runMetric(ws, costDef.id, defs, catalog, { ...range, groupBy: [dimension] }),
  ]);
  const periods = allPeriods([...qtyRows, ...costRows], before, after);
  const memberSeries = (def: MetricDef, rows: typeof qtyRows, key: string | null): Series => {
    const id = `${def.id}|${dimension}=${key ?? "(none)"}`;
    const known = series.get(id);
    if (known) return known.series;
    const at = (p: string) => Number(rows.find((r) => r.period === p && (r[dimension] ?? null) === key)?.value ?? 0);
    const s: Series = {
      id,
      metric: def.id,
      unit: def.id === qtyDef.id ? "count" : "currency",
      member: { dimension, value: key },
      // Every period, as pvmFor: a later decomposition over other periods reuses this series id.
      points: periods.map((p) => ({ period: p, value: at(p) })),
    };
    series.set(id, { series: s, def, where: memberFilter(dimension, key) });
    return s;
  };
  const marginItems: MarginItem[] = items.map((m) => {
    const key = m.member?.value ?? null;
    const q = memberSeries(qtyDef, qtyRows, key);
    const c = memberSeries(costDef, costRows, key);
    return {
      key: String(key),
      r0: valueAt(m, before),
      q0: valueAt(q, before),
      cost0: valueAt(c, before),
      r1: valueAt(m, after),
      q1: valueAt(q, after),
      cost1: valueAt(c, after),
      refs: {
        r0: point(m.id, before),
        q0: point(q.id, before),
        cost0: point(c.id, before),
        r1: point(m.id, after),
        q1: point(q.id, after),
        cost1: point(c.id, after),
      },
    };
  });
  // Only the split against the previous job period is the one the fixed labels (§14) name.
  const marginPeriods = margin.points.map((p) => p.period);
  const previous = marginPeriods[marginPeriods.indexOf(after) - 1];
  const result = pvmMargin(marginItems, after, "currency", previous === before);
  // The items must be all of the margin: their effects add up to the margin metric's own change (a cost with no revenue line
  // in the item list would leave a gap).
  const delta = valueAt(margin, after) - valueAt(margin, before);
  const scale = Math.max(1, Math.abs(delta), ...result.parts.map((c) => Math.abs(c.value)));
  return Math.abs(result.total.value - delta) <= 1e-9 * scale ? result : undefined;
}

/** The dimension margin PVM splits by (spec §10 "Runs"; ids first, since names drift and codes don't): the first of the margin's dimensions with an item role, ids before names. */
export async function marginItemDimension(
  ws: Workspace,
  catalog: Catalog,
  revenueDef: MetricDef | undefined,
  dimensions: readonly string[],
): Promise<string | undefined> {
  const table = catalog.get(revenueDef?.table ?? "");
  if (!table) return undefined;
  const rows = await tableRoles(ws, table.id);
  for (const role of ITEM_PREFERENCE) {
    const hit = rows.find((r) => r.role === role && dimensions.includes(r.column_name));
    if (hit) return hit.column_name;
  }
  return undefined;
}
