// Gross margin, drafted by code when a cost role exists (docs/specs/analysis-library.md §9). `cost`, `gross_margin`
// (derived: revenue − cost) and `gross_margin_pct` (a ratio) go through the metric layer's validation and compiler like
// any definition, so every value is SQL; the pack computes nothing.
import type { ProfileSummary } from "@agentic-analytics/profile";
import type { MetricDef } from "@agentic-analytics/schema";
import { COST_METRIC, COSTED_REVENUE_METRIC, MARGIN_METRIC, MARGIN_PCT_METRIC } from "./margin.ts";
import { type ProfiledTable, timeColumn, withRole } from "./profile-columns.ts";

export interface MarginInput {
  readonly summary: ProfileSummary;
  readonly table: ProfiledTable;
  readonly revenue: { readonly expression: string; readonly currency?: string };
  /** Filters that keep the revenue lines. */
  readonly lines: readonly string[];
  readonly dimensions: readonly string[];
  readonly status: MetricDef["status"];
}

export interface MarginPack {
  readonly defs: MetricDef[];
  readonly assumptions: { readonly metric: string; readonly text: string }[];
  /** Why margin could not be drafted: the §13 reason code. */
  readonly missing?: "no_cost_role" | "no_quantity_role";
}

type Column = ProfiledTable["columns"][number];
const numeric = (c: Column) => c.type === "currency" || c.type === "decimal" || c.type === "integer";

export function marginPack(input: MarginInput): MarginPack {
  const { summary, table, revenue, lines, dimensions, status } = input;
  const costAmount = withRole(summary, table, "cost_amount").find(numeric);
  const unitCost = withRole(summary, table, "unit_cost").find(numeric);
  if (!costAmount && !unitCost) return { defs: [], assumptions: [], missing: "no_cost_role" };
  const qty = withRole(summary, table, "quantity").find((c) => c.type === "integer" || c.type === "decimal");
  if (!costAmount && !qty) return { defs: [], assumptions: [], missing: "no_quantity_role" };
  const column = (costAmount ?? unitCost) as Column;
  const expression = costAmount ? costAmount.name : `${(qty as Column).name} * ${column.name}`;
  const base = { table: table.name, time_column: timeColumn(summary, table) ?? "", status };
  const withLines = lines.length ? { filters: [...lines] } : {};
  // Like revenue: a currency the data doesn't mark is filled in by validation (the --currency default).
  const money = { unit: "currency" as const, ...(revenue.currency ? { currency: revenue.currency } : {}) };
  const defs: MetricDef[] = [
    {
      id: COST_METRIC,
      label: "Cost of goods sold",
      description: `Cost of the revenue lines (${expression}).`,
      type: "sum",
      expression,
      ...withLines,
      ...money,
      dimensions: [...dimensions],
      ...base,
    },
  ];
  const assumptions: MarginPack["assumptions"] = [];
  // A line with no cost is outside margin on both sides: revenue is then measured over the costed lines only.
  // On the quantity × unit cost path a line is costed only when both factors are present: a null quantity gives a null cost,
  // yet its revenue would still count.
  const factors = costAmount ? [column] : [qty as Column, column];
  const partial = factors.some((c) => c.null_pct > 0);
  let revenueId = "revenue";
  if (partial) {
    revenueId = COSTED_REVENUE_METRIC;
    defs.push({
      id: COSTED_REVENUE_METRIC,
      label: "Revenue of lines with a cost",
      description: `Money from the revenue lines that have a cost (${revenue.expression}).`,
      type: "sum",
      expression: revenue.expression,
      filters: [...lines, ...factors.map((c) => `${c.name} IS NOT NULL`)],
      ...money,
      dimensions: [...dimensions],
      ...base,
    });
    assumptions.push({ metric: MARGIN_METRIC, text: "Margin covers only the lines that have a cost." });
  }
  defs.push({
    id: MARGIN_METRIC,
    label: "Gross margin",
    description: `${partial ? "Revenue of lines with a cost" : "Revenue"} minus cost of goods sold.`,
    type: "derived",
    expression: `${revenueId} - ${COST_METRIC}`,
    ...money,
    dimensions: [...dimensions],
    status,
  });
  defs.push({
    id: MARGIN_PCT_METRIC,
    label: "Gross margin %",
    description: "Gross margin as a percentage of revenue.",
    type: "ratio",
    numerator: { metric: MARGIN_METRIC },
    denominator: { metric: revenueId },
    unit: "percent",
    status,
  });
  return { defs, assumptions };
}
