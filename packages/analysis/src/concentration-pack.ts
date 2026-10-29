// The Pareto and concentration pack (analysis-library §8, §11): which metric and dimensions it covers, which windows
// it states, and the facts of its section. Planning is pure; `sectionFacts` turns the plan into facts.
import type { Catalog, Grain } from "@agentic-analytics/metrics";
import type { MetricDef } from "@agentic-analytics/schema";
import type { Workspace } from "@agentic-analytics/store";
import { type ConcentrationFacts, concentrationColumns, DIMENSION_ROLES, dimensionLabels } from "./concentration-facts.ts";
import { type ConcentrationTrend, concentrationTrend, periodStat, trendCalcs } from "./concentration-templates.ts";
import type { FactBook } from "./factbook.ts";
import { CONCENTRATION_PARTS, type Member, PARETO_PARTS, type StatPart } from "./pareto.ts";
import { tableRoles } from "./roles.sql.ts";
import type { Calc, StatRef } from "./types.ts";
import { completeYears, type TrailingWindows, trailingWindows } from "./windows.ts";

/** An analysis the pack could not run, and why (analysis-library §13); `not-run.ts` words it for the report. */
export interface ConcentrationGap {
  readonly analysis: "pareto.v1" | "concentration";
  readonly reason_code: "no_dimension" | "no_amount_role" | "too_few_periods";
  /** The window it concerns, when it is one of several (`ttm_prev`). */
  readonly window?: "ttm_prev";
}

const isAdditiveCurrency = (d: MetricDef) => (d.type === "sum" || d.type === "count") && d.unit === "currency";

/**
 * The metric the pack measures: `revenue` when it is an additive currency metric, else the first one that is (§11). The
 * objective is not consulted, so the planner tool and the runner always agree on which metric's labels are unqualified.
 */
export function packMetric(defs: readonly MetricDef[]): MetricDef | undefined {
  return defs.find((d) => d.id === "revenue" && isAdditiveCurrency(d)) ?? defs.find(isAdditiveCurrency);
}

/** A dimension column the pack covers, with its label name (§14). */
export interface PackDimension {
  readonly column: string;
  readonly dim: string;
}

/** The pack's dimension columns (those with an entity or grouping role), customer first (§11, §11.4). */
export function packDimensions(labels: ReadonlyMap<string, string>, grouping: readonly string[]): PackDimension[] {
  const order = Object.keys(DIMENSION_ROLES);
  const rank = (dim: string) => order.indexOf(dim.split("~")[0] ?? "");
  return grouping.map((column) => ({ column, dim: labels.get(column) ?? column })).sort((a, b) => rank(a.dim) - rank(b.dim));
}

/** Per period, the members of a dimension and their values (those a period has rows for). */
export function membersByPeriod(byMember: ReadonlyMap<string | null, readonly { period: string; value: number }[]>): Map<string, Member[]> {
  const out = new Map<string, Member[]>();
  for (const [key, points] of byMember)
    for (const p of points) {
      const list = out.get(p.period);
      if (list) list.push({ key, total: p.value });
      else out.set(p.period, [{ key, total: p.value }]);
    }
  return out;
}

export interface SectionPlan {
  readonly windows: TrailingWindows;
  /** The statistics stated without a finding: each window's classes, the latest period's and each year's concentration. */
  readonly refs: readonly StatRef[];
  readonly trend: ConcentrationTrend;
  readonly calcs: readonly Calc[];
}

/** The statistics of §11 for one metric and dimension over periods `first`…`last` (`periods` are those with data). */
export function planSection(
  metric: string,
  dimension: string,
  dim: string,
  periods: readonly string[],
  perPeriod: ReadonlyMap<string, readonly Member[]>,
  grain: Grain,
): SectionPlan | undefined {
  const first = periods[0];
  const last = periods.at(-1);
  if (first === undefined || last === undefined) return undefined;
  const windows = trailingWindows(first, last, grain);
  const ref = (part: StatPart, from: string, to: string, suffix: string): StatRef => ({
    kind: "stat",
    metric,
    dimension,
    part,
    from,
    to,
    suffix,
  });
  const refs: StatRef[] = [
    ...[...PARETO_PARTS, ...CONCENTRATION_PARTS].map((p) => ref(p, windows.ttm.from, windows.ttm.to, "ttm")),
    ...(windows.ttmPrev ? PARETO_PARTS.map((p) => ref(p, windows.ttmPrev?.from ?? "", windows.ttmPrev?.to ?? "", "ttm_prev")) : []),
    ...CONCENTRATION_PARTS.map((p) => periodStat(metric, dimension, p, last)),
    ...completeYears(first, last, grain).flatMap(([year, w]) => CONCENTRATION_PARTS.map((p) => ref(p, w.from, w.to, String(year)))),
  ];
  const trend = concentrationTrend(perPeriod, periods);
  return { windows, refs, trend, calcs: trendCalcs(metric, dimension, dim, trend) };
}

/** Creates the facts of a section; a statistic that is not stated over its window (a top-10 share of 6 members) is skipped. */
export async function sectionFacts(book: FactBook, facts: ConcentrationFacts, plan: SectionPlan, context: string): Promise<void> {
  for (const ref of plan.refs) if (await facts.has(ref)) await book.resolve(ref, new Map());
  if (plan.calcs.length) await book.calcs(plan.calcs, context);
}

/**
 * What the pack could not run (§13): no additive money metric to measure (`no_amount_role`), no dimension with a role
 * (`no_dimension`), or no data for the year before the trailing year.
 */
export function notRun(setup: Pick<ConcentrationSetup, "pack" | "dimensions">, plan: SectionPlan | undefined): ConcentrationGap[] {
  const missing = !setup.pack ? "no_amount_role" : !setup.dimensions.length ? "no_dimension" : undefined;
  if (missing)
    return [
      { analysis: "pareto.v1", reason_code: missing },
      { analysis: "concentration", reason_code: missing },
    ];
  return plan && !plan.windows.ttmPrev ? [{ analysis: "pareto.v1", window: "ttm_prev", reason_code: "too_few_periods" }] : [];
}

/**
 * The pack metric's role columns it was not split by (§11 covers each column with an entity or grouping role): their
 * per-period members are measured for the pack alone. One column per dimension: a dimension the metric is already split
 * by, or a second column of the same one (a product name beside its code, which restates the same members), is not
 * measured again. Empty when there is no pack metric or it has no table.
 */
export async function unsplitPackColumns(
  ws: Workspace,
  catalog: Catalog,
  defs: readonly MetricDef[],
  splits: ReadonlyMap<string, readonly string[]>,
): Promise<{ readonly metric?: string; readonly columns: readonly string[] }> {
  const pack = packMetric(defs);
  const table = catalog.get(pack?.table ?? "");
  if (!pack || !table) return { columns: [] };
  const split = new Set([...(splits.get(pack.id) ?? []), ...(pack.dimensions ?? [])]);
  const dimOf = (role: string) => Object.entries(DIMENSION_ROLES).find(([, roles]) => roles.includes(role))?.[0];
  const stored = (await tableRoles(ws, table.id)).flatMap((r) => {
    const dim = dimOf(r.role);
    return dim ? [{ column: r.column_name, dim }] : [];
  });
  const covered = new Set(stored.filter((r) => split.has(r.column)).map((r) => r.dim));
  const columns: string[] = [];
  // Best score first (`tableRoles`), so a dimension's first column is the one its role fits best.
  for (const r of stored)
    if (!split.has(r.column) && !covered.has(r.dim)) {
      covered.add(r.dim);
      columns.push(r.column);
    }
  return { metric: pack.id, columns };
}

export interface ConcentrationSetup {
  /** The label name of a metric's dimension column (§14): qualified with the metric unless it is the pack's. */
  readonly dimOf: (metric: string, column: string) => string;
  readonly pack?: MetricDef;
  /** The pack's dimensions, customer first, each with its plan. */
  readonly dimensions: readonly (PackDimension & { readonly plan: SectionPlan })[];
}

/**
 * Labels for every split metric's dimensions and the pack's plans. `splits` is the dimension columns each additive metric
 * was split by; `periods` the periods of the pack metric's total.
 */
export async function setupConcentration(
  ws: Workspace,
  catalog: Catalog,
  defs: readonly MetricDef[],
  splits: ReadonlyMap<string, readonly string[]>,
  periods: (metric: string) => readonly string[],
  perPeriod: ReadonlyMap<string, ReadonlyMap<string, readonly Member[]>>,
  grain: Grain,
): Promise<ConcentrationSetup> {
  const pack = packMetric(defs);
  const labels = new Map<string, ReadonlyMap<string, string>>();
  const grouping = new Map<string, readonly string[]>();
  for (const [metric, columns] of splits) {
    const def = defs.find((d) => d.id === metric);
    const table = catalog.get(def?.table ?? "");
    if (!table) continue;
    // Labelled over every dimension of the metric, as the `concentration` tool does, so both paths name a column alike;
    // only the columns the metric was split by are planned.
    const l = await dimensionLabels(ws, table.id, await concentrationColumns(ws, table.id, def?.dimensions ?? columns));
    labels.set(metric, l.labels);
    grouping.set(
      metric,
      l.grouping.filter((c) => columns.includes(c)),
    );
  }
  const dimOf = (metric: string, column: string) => {
    const label = labels.get(metric)?.get(column) ?? column;
    return pack && metric === pack.id ? label : `${label}[${metric}]`;
  };
  const dimensions = pack
    ? packDimensions(labels.get(pack.id) ?? new Map(), grouping.get(pack.id) ?? []).flatMap((d) => {
        const plan = planSection(pack.id, d.column, d.dim, periods(pack.id), perPeriod.get(`${pack.id}|${d.column}`) ?? new Map(), grain);
        return plan ? [{ ...d, plan }] : [];
      })
    : [];
  return { dimOf, ...(pack ? { pack } : {}), dimensions };
}
