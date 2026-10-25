// The sales KPI pack (docs/specs/analysis-library.md §8.1, metric-layer §2 step 0): metric definitions that code drafts
// from a sales table's roles, so a small model cannot miss them. Each KPI is drafted only when its roles exist; one
// that cannot be drafted is listed with the reason (§13 "Analyses not run"). Nothing here computes a number: the
// definitions go through the metric layer's validation and compiler like any others.
import type { ProfileSummary } from "@agentic-analytics/profile";
import type { MetricDef, RatioTerm } from "@agentic-analytics/schema";
import { groupingColumns, type ProfiledTable, REFUND_VALUE, withRole } from "./profile-columns.ts";

/** Values that mark a cancellation; the rest of REFUND_VALUE is a refund or a return (§8.1 "Revenue lines"). */
const CANCEL_VALUE = /cancel|void|отмен|bekor/i;
const CANCEL_NAME = /cancel|void|отмен|bekor/i;
const REFUND_NAME = /refund|return|возврат|qaytar/i;

export type KpiId =
  | "revenue"
  | "orders"
  | "units"
  | "aov"
  | "customers"
  | "new_customers"
  | "returning_customers"
  | "refund_rate"
  | "cancellation_rate"
  | "discount_rate";

/** Why a KPI could not be drafted: the vocabulary of analysis-library §13 for `kpi.<id>`. */
export type NotDraftedReason =
  | "no_revenue_role"
  | "no_order_id"
  | "no_quantity_role"
  | "no_customer_role"
  | "no_refund_role"
  | "no_status_role"
  | "no_discount_role";

export interface NotDrafted {
  readonly kpi: KpiId;
  readonly reason: NotDraftedReason;
}

/** The table and revenue definition the pack is built on; the channel fallback slices it. */
export interface SalesBase {
  readonly table: ProfiledTable;
  /** What revenue sums, over the revenue lines. */
  readonly expression: string;
  readonly currency?: string;
  /** Filters that keep the revenue lines (refunded and cancelled lines out). */
  readonly revenueLines: readonly string[];
}

export interface KpiPack {
  readonly base?: SalesBase;
  readonly defs: MetricDef[];
  readonly notDrafted: NotDrafted[];
  readonly assumptions: { readonly metric: string; readonly text: string }[];
}

type Column = ProfiledTable["columns"][number];

const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** A status column's refund and cancellation classes: values of a category, or a 0/1 flag read by its header. */
interface StatusClass {
  readonly column: string;
  readonly form: "values" | "flag";
  readonly flagLiteral?: string;
  readonly refund: readonly string[];
  readonly cancel: readonly string[];
  /** For a flag: which class its header names. */
  readonly flagKind?: "refund" | "cancel";
}

function statusClasses(summary: ProfileSummary, table: ProfiledTable): StatusClass[] {
  const out: StatusClass[] = [];
  for (const c of withRole(summary, table, "status")) {
    if (c.type === "boolean" || c.type === "integer") {
      const header = `${c.label} ${c.name}`;
      const flagKind = CANCEL_NAME.test(header) ? "cancel" : REFUND_NAME.test(header) ? "refund" : undefined;
      if (flagKind)
        out.push({ column: c.name, form: "flag", flagLiteral: c.type === "boolean" ? "TRUE" : "1", refund: [], cancel: [], flagKind });
      continue;
    }
    const values = c.top_values.map((v) => v.value).filter((v) => REFUND_VALUE.test(v));
    const cancel = values.filter((v) => CANCEL_VALUE.test(v));
    const refund = values.filter((v) => !cancel.includes(v));
    if (values.length) out.push({ column: c.name, form: "values", refund, cancel });
  }
  return out;
}

/** The condition that selects one class (`refund` or `cancel`) in one status column, or undefined when it has none. */
function classFilter(s: StatusClass, kind: "refund" | "cancel"): string | undefined {
  if (s.form === "flag") return s.flagKind === kind ? `${s.column} = ${s.flagLiteral}` : undefined;
  const values = s[kind];
  return values.length ? `${s.column} IN (${values.map(quote).join(", ")})` : undefined;
}

/** A line is a revenue line unless a status column puts it in the refund or cancellation class; no status counts as revenue. */
function revenueLineFilters(classes: readonly StatusClass[]): string[] {
  return classes.map((s) => {
    if (s.form === "flag") return `${s.column} IS NULL OR ${s.column} = ${s.flagLiteral === "TRUE" ? "FALSE" : "0"}`;
    return `${s.column} IS NULL OR ${s.column} NOT IN (${[...s.refund, ...s.cancel].map(quote).join(", ")})`;
  });
}

const kindOf = (summary: ProfileSummary, table: ProfiledTable) =>
  summary.semantics?.table_kinds.find((k) => k.table_id === table.table_id)?.kind;
const KIND_ORDER = ["sales_lines", "invoices"] as const;

/** What revenue sums in a table: the amount column, else quantity × unit price (a line total). */
function revenueOf(summary: ProfileSummary, table: ProfiledTable): { expression: string; currency?: string } | undefined {
  const money = withRole(summary, table, "amount").find((c) => c.type === "currency");
  if (money) return { expression: money.name, ...(money.currency ? { currency: money.currency } : {}) };
  const price = withRole(summary, table, "unit_price").find((c) => c.type === "currency");
  const qty = withRole(summary, table, "quantity").find((c) => c.type === "integer" || c.type === "decimal");
  if (price && qty) return { expression: `${qty.name} * ${price.name}`, ...(price.currency ? { currency: price.currency } : {}) };
  return undefined;
}

/**
 * The table the pack is built on: a `sales_lines` table, else an `invoices` table (§8), the largest dated one that has a
 * revenue definition. A table of another kind with the same roles is used last, as the name-based fallback did before roles.
 */
function salesTable(
  summary: ProfileSummary,
): { table: ProfiledTable; revenue: NonNullable<ReturnType<typeof revenueOf>>; sales: boolean } | undefined {
  const dated = [...summary.tables].filter((t) => t.date_column).sort((a, b) => b.detail_rows - a.detail_rows);
  const groups = [
    ...KIND_ORDER.map((k) => dated.filter((t) => kindOf(summary, t) === k)),
    dated.filter((t) => !KIND_ORDER.includes(kindOf(summary, t) as never)),
  ];
  for (const [i, group] of groups.entries())
    for (const table of group) {
      const revenue = revenueOf(summary, table);
      if (revenue) return { table, revenue, sales: i < KIND_ORDER.length };
    }
  return undefined;
}

const first = (cols: readonly Column[], ...types: Column["type"][]) => cols.find((c) => types.includes(c.type));

/**
 * Drafts the sales KPI pack from the confirmed or assumed roles in `summary.semantics` (§8.1). The same roles always
 * give the same definitions, and no model is called.
 */
export function salesKpiPack(summary: ProfileSummary): KpiPack {
  const found = salesTable(summary);
  if (!found) return { defs: [], notDrafted: [], assumptions: [] };
  const { table, revenue, sales } = found;
  const classes = statusClasses(summary, table);
  const lines = revenueLineFilters(classes);
  const statusNames = new Set(withRole(summary, table, "status").map((c) => c.name));
  const dimensions = groupingColumns(
    table,
    table.columns.find((c) => classes[0]?.column === c.name),
  ).filter((c) => !statusNames.has(c));
  const base = { table: table.name, time_column: table.date_column ?? "", status: "assumed" as const };
  const withLines = lines.length ? { filters: lines } : {};
  const money = revenue.currency ? { currency: revenue.currency } : {};
  const defs: MetricDef[] = [];
  const notDrafted: NotDrafted[] = [];
  const assumptions: KpiPack["assumptions"] = [];
  const miss = (kpi: KpiId, reason: NotDraftedReason) => notDrafted.push({ kpi, reason });

  defs.push({
    id: "revenue",
    label: "Revenue",
    description: `Money from sales lines (${revenue.expression}), leaving out refunded and cancelled lines.`,
    type: "sum",
    expression: revenue.expression,
    ...withLines,
    unit: "currency",
    ...money,
    dimensions,
    ...base,
  });

  const orderCol =
    first(withRole(summary, table, "order_id"), "id", "category", "integer", "text") ??
    first(withRole(summary, table, "invoice_id"), "id", "category", "integer", "text");
  const orders = (id: string, label: string, description: string, filters: readonly string[], dims: readonly string[]): MetricDef => ({
    id,
    label,
    description,
    type: "count_distinct",
    expression: orderCol?.name ?? "",
    ...(filters.length ? { filters: [...filters] } : {}),
    unit: "count",
    dimensions: [...dims],
    ...base,
  });
  if (orderCol)
    defs.push(
      orders(
        "orders",
        "Orders",
        "Distinct orders with at least one revenue line.",
        lines,
        dimensions.filter((d) => d !== orderCol.name),
      ),
    );
  else miss("orders", "no_order_id");

  const qty = first(withRole(summary, table, "quantity"), "integer", "decimal");
  if (qty)
    defs.push({
      id: "units",
      label: "Units sold",
      description: `Total ${qty.label} over revenue lines.`,
      type: "sum",
      expression: qty.name,
      ...withLines,
      unit: "count",
      dimensions,
      ...base,
    });
  else miss("units", "no_quantity_role");

  if (orderCol)
    defs.push({
      id: "aov",
      label: "Average order value",
      description: "Revenue divided by orders.",
      type: "ratio",
      numerator: { metric: "revenue" },
      denominator: { metric: "orders" },
      // Money per order, in revenue's currency when the profile knows it (analysis-library §6).
      ...(money.currency ? { unit: "currency" as const, currency: money.currency } : { unit: "ratio" as const }),
      status: "assumed",
    });
  else miss("aov", "no_order_id");

  const customer =
    first(withRole(summary, table, "customer_id"), "id", "category", "integer", "text") ??
    first(withRole(summary, table, "customer"), "id", "category", "integer", "text");
  if (customer) {
    const dims = dimensions.filter((d) => d !== customer.name);
    const customers = (id: string, label: string, description: string, cohort?: "new" | "returning"): MetricDef => ({
      id,
      label,
      description,
      type: "count_distinct",
      expression: customer.name,
      ...withLines,
      ...(cohort ? { cohort } : {}),
      unit: "count",
      dimensions: dims,
      ...base,
    });
    defs.push(customers("customers", "Customers", "Distinct customers with at least one revenue line."));
    defs.push(customers("new_customers", "New customers", "Customers whose first revenue line falls in the period.", "new"));
    defs.push(
      customers(
        "returning_customers",
        "Returning customers",
        "Customers active in the period whose first revenue line is earlier.",
        "returning",
      ),
    );
  } else for (const kpi of ["customers", "new_customers", "returning_customers"] as const) miss(kpi, "no_customer_role");

  // The cancellation rate counts orders: distinct order ids through helper metrics (a ratio term can only sum), or with no
  // order id one per row. The helpers carry the grouping columns, so the rate's split by member can read them (§4.3).
  const helperDims = dimensions.filter((d) => d !== orderCol?.name);
  const cancellationRate = (): void => {
    const filter = [classes.flatMap((s) => classFilter(s, "cancel") ?? []).join(" OR ")];
    let numerator: RatioTerm = { table: table.name, expression: "1", filters: filter };
    let denominator: RatioTerm = { table: table.name, expression: "1" };
    if (orderCol) {
      defs.push(orders("cancelled_orders", "Cancelled orders", "Distinct orders with a cancelled line.", filter, helperDims));
      defs.push(orders("all_orders", "All orders", "Distinct orders, cancelled ones included.", [], helperDims));
      numerator = { metric: "cancelled_orders" };
      denominator = { metric: "all_orders" };
    }
    defs.push({
      id: "cancellation_rate",
      label: "Cancellation rate",
      description: "Orders with a cancelled line, as a percentage of all orders.",
      type: "ratio",
      numerator,
      denominator,
      unit: "percent",
      status: "assumed",
    });
  };
  const refundAmount = first(withRole(summary, table, "refund_amount"), "currency", "decimal", "integer");
  if (refundAmount)
    defs.push({
      id: "refund_rate",
      label: "Refund rate",
      description: `Refunded money (${refundAmount.label}) as a percentage of revenue.`,
      type: "ratio",
      numerator: { table: table.name, expression: refundAmount.name },
      denominator: { metric: "revenue" },
      unit: "percent",
      status: "assumed",
    });
  else if (classes.some((s) => classFilter(s, "refund")))
    defs.push({
      id: "refund_rate",
      label: "Refund rate",
      description: "Value of refunded or returned lines as a percentage of revenue.",
      type: "ratio",
      numerator: {
        table: table.name,
        expression: revenue.expression,
        filters: [classes.flatMap((s) => classFilter(s, "refund") ?? []).join(" OR ")],
      },
      denominator: { metric: "revenue" },
      unit: "percent",
      status: "assumed",
    });
  else miss("refund_rate", "no_refund_role");
  if (classes.some((s) => classFilter(s, "cancel"))) cancellationRate();
  else miss("cancellation_rate", "no_status_role");

  const discount = first(withRole(summary, table, "discount"), "currency", "decimal", "integer");
  const price = first(withRole(summary, table, "unit_price"), "currency", "decimal");
  if (discount) {
    const gross = qty && price ? `${qty.name} * ${price.name}` : `${revenue.expression} + ${discount.name}`;
    defs.push({
      id: "discount_rate",
      label: "Discount rate",
      description: `Discounts (${discount.label}) as a percentage of gross sales (${gross}).`,
      type: "ratio",
      numerator: { table: table.name, expression: discount.name, ...(lines.length ? { filters: lines } : {}) },
      denominator: { table: table.name, expression: gross, ...(lines.length ? { filters: lines } : {}) },
      unit: "percent",
      status: "assumed",
    });
    if (!(qty && price))
      assumptions.push({
        metric: "discount_rate",
        text: `Gross sales for the discount rate are ${revenue.expression} plus ${discount.name}: the amount is taken to be net of discount.`,
      });
  } else miss("discount_rate", "no_discount_role");

  // Only a table read as sales lines or invoices owes the reader an account of what is missing (§13).
  return {
    base: { table, expression: revenue.expression, ...money, revenueLines: lines },
    defs,
    notDrafted: sales ? notDrafted : [],
    assumptions,
  };
}
