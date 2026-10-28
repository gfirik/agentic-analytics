// "Analyses not run" (docs/specs/analysis-library.md §13, semantics §1 "Graceful absence"): a deterministic list, built
// from each pack's required roles and kinds, of the analyses that could not run and why. No model is called, and no
// entry carries a number: the reason is one sentence without numerals (V1's rule), and the thresholds live in the code.
import type { Grain, NotDrafted } from "@agentic-analytics/metrics";
import type { NotRun, NotRunReason } from "@agentic-analytics/schema";
import type { ConcentrationGap } from "./concentration-pack.ts";
import { yoyGap } from "./scorecard.ts";

/** The roles margin reads its cost from (analysis-library §9). */
export const COST_ROLES = ["unit_cost", "cost_amount"] as const;

/** What each reason needs: the roles (semantics §1) whose absence it reports; none for a shortage of history. */
const NEEDS: Readonly<Record<NotRunReason, readonly string[]>> = {
  no_cost_role: COST_ROLES,
  no_quantity_role: ["quantity"],
  no_price_role: ["unit_price"],
  no_item_dimension: ["product", "product_id", "product_group"],
  no_variable_cost: ["variable cost"],
  no_dimension: [
    "customer",
    "customer_id",
    "product",
    "product_id",
    "supplier",
    "supplier_id",
    "channel",
    "location",
    "salesperson",
    "product_group",
  ],
  too_few_periods: [],
  grain_not_comparable: [],
  no_order_id: ["order_id", "invoice_id"],
  no_customer_role: ["customer_id", "customer"],
  no_refund_role: ["refund_amount", "status"],
  no_discount_role: ["discount"],
  no_status_role: ["status"],
  no_history: [],
};

/** The sentence for each reason. No numerals: "fewer than 13 months" is "not enough history" (§13). */
const REASON: Readonly<Record<NotRunReason, string>> = {
  no_cost_role: "There is no cost column (unit cost or cost amount), so margin can't be computed.",
  no_quantity_role: "There is no quantity column, so the change can't be split into price, volume and mix.",
  no_price_role: "There is no unit price column, so prices can't be compared.",
  no_item_dimension: "There is no product or product group column to split the change by item.",
  no_variable_cost: "There is no variable cost column, so contribution margin can't be computed.",
  no_dimension:
    "There is no customer, product, supplier, channel, location, salesperson or product group column to measure concentration over.",
  too_few_periods: "There is not enough history for a year-on-year comparison.",
  grain_not_comparable: "Year-on-year is not compared at weekly or daily grain.",
  no_order_id: "There is no order or invoice number column.",
  no_customer_role: "There is no customer column.",
  no_refund_role: "There is no refund amount column, and no status marks refunded or returned lines.",
  no_discount_role: "There is no discount column.",
  no_status_role: "No status column marks cancelled lines.",
  no_history: "Every customer is new in the first period of the data, so new customers can't be told apart.",
};

/** Reasons for an analysis whose wording differs from the reason's default. */
const SPECIAL: Readonly<Record<string, string>> = {
  "gross_margin/no_quantity_role":
    "Unit cost needs a quantity column to give the cost of each line, and there is none, so margin can't be computed.",
  "pvm_margin.v1/no_cost_role":
    "There is no cost column (unit cost or cost amount), so the margin change can't be split into price, cost, volume and mix.",
  "pvm_margin.v1/no_quantity_role": "There is no quantity column, so the margin change can't be split into price, cost, volume and mix.",
  "pareto.v1/too_few_periods": "The data doesn't cover the year before the trailing year, so the classes can't be compared with it.",
};

/** The KPI names in a reason (§8.1); the analysis id is `kpi.<id>`. */
const KPI_LABEL: Readonly<Record<string, string>> = {
  orders: "Orders",
  units: "Units sold",
  aov: "Average order value",
  customers: "Customers",
  new_customers: "New customers",
  returning_customers: "Returning customers",
  refund_rate: "Refund rate",
  cancellation_rate: "Cancellation rate",
  discount_rate: "Discount rate",
};

const entry = (analysis: string, code: NotRunReason, prefix?: string): NotRun => {
  const text = SPECIAL[`${analysis}/${code}`] ?? REASON[code];
  return {
    analysis,
    reason_code: code,
    reason: prefix ? `${prefix}: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text,
    needs: [...NEEDS[code]],
  };
};

const isReason = (r: string): r is NotRunReason => Object.hasOwn(REASON, r);

export interface NotRunInput {
  /** The KPIs the sales pack could not draft (metrics `salesKpiPack`), from the roles as they stand. */
  readonly notDrafted: readonly NotDrafted[];
  /** The ids of the job's metrics: a KPI the person defined themselves is not "not run". */
  readonly metrics: ReadonlySet<string>;
  /** Whether any column of the job has a cost role (`unit_cost`, `cost_amount`). */
  readonly costRole?: boolean;
  /** The sales pack's revenue (`packMetric`) and what price–volume–mix finds beside it; undefined without one. */
  readonly sales?: { readonly sum: boolean; readonly quantity: boolean; readonly item: boolean };
  /** What the Pareto and concentration pack could not run (`concentration-pack.ts`). */
  readonly concentration: readonly ConcentrationGap[];
  readonly grain: Grain;
  /** The job's periods, sorted. */
  readonly periods: readonly string[];
}

/** The "Analyses not run" list (§13), each analysis and reason once, in the order of §13's table. */
export function analysesNotRun(input: NotRunInput): NotRun[] {
  const out: NotRun[] = [];
  const add = (n: NotRun) => {
    if (!out.some((x) => x.analysis === n.analysis && x.reason_code === n.reason_code)) out.push(n);
  };
  const margin = input.metrics.has("gross_margin");
  const marginGap = (code: NotRunReason) => {
    add(entry("gross_margin", code));
    add(entry("pvm_margin.v1", code));
  };
  for (const n of input.notDrafted) if (n.kpi === "gross_margin" && isReason(n.reason) && !margin) marginGap(n.reason);
  // With no cost column anywhere, margin can't run whether or not a sales pack was drafted (a table with a year and a
  // month column has no pack yet, M15 PR 9): the role is what is missing (semantics §1 "Graceful absence").
  if (!margin && input.costRole === false) marginGap("no_cost_role");
  // PVM reads revenue and quantity per item (§4.2): its price is revenue ÷ quantity, so no unit price role is needed.
  if (input.sales?.sum) {
    const gaps: NotRunReason[] = [
      ...(input.sales.quantity ? [] : ["no_quantity_role" as const]),
      ...(input.sales.item ? [] : ["no_item_dimension" as const]),
    ];
    for (const code of gaps) {
      if (margin) add(entry("pvm_margin.v1", code));
      add(entry("pvm.v1", code));
    }
  }
  if (input.sales) add(entry("contribution_margin", "no_variable_cost"));
  for (const g of input.concentration) add(entry(g.analysis, g.reason_code));
  // The same rule as the scorecard's column (§12), so the two agree.
  const yoy = yoyGap(input.grain, input.periods[0], input.periods.at(-1));
  if (yoy) add(entry("yoy", yoy));
  for (const n of input.notDrafted)
    if (n.kpi !== "gross_margin" && isReason(n.reason) && !input.metrics.has(n.kpi)) add(entry(`kpi.${n.kpi}`, n.reason, KPI_LABEL[n.kpi]));
  if (input.metrics.has("new_customers") && input.periods.length === 1)
    add(entry("kpi.new_customers", "no_history", KPI_LABEL.new_customers));
  return out;
}
