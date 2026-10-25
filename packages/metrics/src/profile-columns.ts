// Reading a profiled table by its roles and its grouping columns (metric-layer §2 steps 4–5): shared by the KPI pack
// (kpi-pack.ts) and the fallbacks and model drafts (draft.ts).
import type { ProfileSummary, Role } from "@agentic-analytics/profile";
import type { MetricDef } from "@agentic-analytics/schema";
import { screen } from "@agentic-analytics/schema";

/** Values that mark a refund or a cancellation (also in Russian and Uzbek). */
export const REFUND_VALUE = /refund|return|cancel|chargeback|возврат|отмен|qaytar/i;

/** Grouping columns can have many values: the analysis keeps the top members and an "(other)" bucket. */
export const MAX_GROUPING_VALUES = 2000;
/** A category with at least this many distinct values per row (and more than 50) is an identifier, not a grouping. */
export const ID_LIKE_SHARE = 0.5;
/** Below this many rows the per-row share says nothing (60 customers in 100 rows is still a grouping). */
export const ID_LIKE_MIN_ROWS = 500;

export type ProfiledTable = ProfileSummary["tables"][number];

/**
 * The columns a change can be explained by (customer, channel, product, …): categories with 2 to
 * MAX_GROUPING_VALUES values, except a refund/return status column (a filter rather than a grouping) and id-like columns.
 */
export function groupingColumns(table: ProfiledTable, statusCol?: ProfiledTable["columns"][number]): string[] {
  const status = statusCol ?? table.columns.find((c) => c.type === "category" && c.top_values.some((v) => REFUND_VALUE.test(v.value)));
  return (
    table.columns
      .filter((c) => c.type === "category" && c !== status && c.distinct_count >= 2 && c.distinct_count <= MAX_GROUPING_VALUES)
      // A column whose header addresses a model is never a grouping: its name would reach the planner as a dimension,
      // and a definition naming it is refused, which would cost the metric itself (security §3).
      .filter((c) => !screen(c.label) && !screen(c.name))
      // An id-like column (an invoice number, an email: nearly one value per row) explains nothing and multiplies the
      // member series; a grouping repeats its values across rows.
      .filter((c) => c.distinct_count <= 50 || table.detail_rows < ID_LIKE_MIN_ROWS || c.distinct_count < ID_LIKE_SHARE * table.detail_rows)
      .map((c) => c.name)
  );
}

/** A drafted sum, count or average gets every grouping column of its table, after the ones it named. */
export function withGroupingDimensions(def: MetricDef, summary: ProfileSummary): MetricDef {
  if (!["sum", "count", "count_distinct", "avg"].includes(def.type) || !def.table) return def;
  const table = summary.tables.find((t) => t.name === def.table);
  if (!table) return def;
  const have = def.dimensions ?? [];
  // A column the metric's filter pins to one value (`channel = 'wholesale'`) has a single member, whose series is
  // the metric itself: splitting by it only restates the whole-metric change.
  const pinned = (c: string) =>
    (def.filters ?? []).some((f) => new RegExp(`(^|[^\\w"])"?${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?\\s*=\\s*'`).test(f));
  const add = groupingColumns(table).filter((c) => !have.includes(c) && !pinned(c));
  return add.length ? { ...def, dimensions: [...have, ...add] } : def;
}

/** The table's columns that have a role, best score first (semantics §1: roles replaced the header regexes of M4). */
export function withRole(summary: ProfileSummary, table: ProfiledTable, ...roles: Role[]): ProfiledTable["columns"] {
  const detected = summary.semantics?.roles.find((r) => r.table_id === table.table_id);
  if (!detected) return [];
  return detected.columns
    .filter((c) => roles.includes(c.role))
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .flatMap((c) => table.columns.filter((x) => x.name === c.column));
}
