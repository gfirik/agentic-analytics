// Table kinds (docs/specs/semantics.md §3): classified from a table's roles, first matching rule wins, each kind records
// the roles that matched. Deterministic and model-free: a table's kind is a function of its proposed (or confirmed)
// roles, the identities the detector measured, and the names it carries.
import { tableName, type Workspace } from "@agentic-analytics/store";
import type { TableRoles } from "./detect.ts";
import { uniqueKey } from "./roles.sql.ts";
import type { Role } from "./vocabulary.ts";

export const TABLE_KINDS = [
  "invoices",
  "bills",
  "inventory_snapshot",
  "bank_cash",
  "budget_plan",
  "period_summary",
  "sales_lines",
  "other",
] as const;
export type TableKind = (typeof TABLE_KINDS)[number];

export interface KindResult {
  readonly table_id: string;
  readonly kind: TableKind;
  /** The roles that matched, in the order the rule names them (report.json `table_kinds[].evidence`). */
  readonly evidence: readonly string[];
}

/** Facts about the table that the roles alone don't carry. */
export interface KindContext {
  /** Names the table goes by: its sheet, file and table label (§3 rule 5 reads them for "budget", "plan", ...). */
  readonly names?: readonly string[];
  /** The amount column has both negative and positive values (§3 rule 4). */
  readonly signedAmount?: boolean;
  /** The date column together with the dimension columns is a unique key (§3 rule 6). */
  readonly uniqueDateKey?: boolean;
}

/** Budget, plan, target and forecast in English, Russian and Uzbek (§3 rule 5), as whole words. */
const PLAN_WORD =
  /(^|[^\p{L}])(budget|budgets|plan|plans|planned|target|targets|forecast|forecasts|бюджет\p{L}*|план\p{L}*|reja|byudjet)([^\p{L}]|$)/iu;

/** The roles that make a column a dimension of an aggregated row (the key of a summary, §3 rule 6). */
const DIMENSION_ROLES: ReadonlySet<Role> = new Set([
  "customer",
  "product",
  "product_group",
  "channel",
  "location",
  "supplier",
  "salesperson",
  "dimension",
  "status",
  "currency",
]);
const MEASURE_ROLES: ReadonlySet<Role> = new Set(["amount", "measure", "count", "quantity", "cost_amount"]);
const ID_ROLES: ReadonlySet<Role> = new Set(["order_id", "invoice_id", "line_id"]);

const roleSet = (r: Pick<TableRoles, "columns">): Set<Role> => new Set(r.columns.map((c) => c.role).filter((x) => x !== "none"));

/** The columns the table's proposals give a role, best score first (ties by position). */
export function columnsWith(r: Pick<TableRoles, "columns">, ...roles: readonly Role[]): string[] {
  return r.columns
    .filter((c) => roles.includes(c.role))
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .map((c) => c.column);
}

/** The columns that make up a date plus dimensions key, for the uniqueness check of §3 rule 6. */
export function keyColumns(r: Pick<TableRoles, "columns">): { date?: string; dimensions: string[] } {
  const date = columnsWith(r, "transaction_date")[0];
  return { ...(date ? { date } : {}), dimensions: columnsWith(r, ...DIMENSION_ROLES) };
}

/** Whether the table's identities include a quantity × unit price line identity that holds (§3 rule 6). */
const hasLineIdentity = (r: Pick<TableRoles, "identities">): boolean =>
  r.identities.some((i) => i.holds && (i.check === "gross_line" || i.check === "net_line"));

export function classifyKind(
  roles: Pick<TableRoles, "table_id" | "columns" | "identities" | "period_parts">,
  ctx: KindContext = {},
): KindResult {
  const has = roleSet(roles);
  const result = (kind: TableKind, evidence: readonly string[]): KindResult => ({ table_id: roles.table_id, kind, evidence });
  const customer = has.has("customer_id") ? "customer_id" : has.has("customer") ? "customer" : undefined;
  const supplier = has.has("supplier_id") ? "supplier_id" : has.has("supplier") ? "supplier" : undefined;
  const product = has.has("product_id") ? "product_id" : has.has("product") ? "product" : undefined;
  const optional = (...rs: Role[]) => rs.filter((r) => has.has(r));

  // 1–2. A register of invoices: receivables when the counterpart is a customer, payables when it is a supplier.
  if (has.has("invoice_id") && has.has("issue_date") && has.has("due_date")) {
    const base = ["invoice_id", "issue_date", "due_date"];
    if (customer && !supplier) return result("invoices", [...base, customer, ...optional("paid_date", "paid_amount")]);
    if (supplier && !customer) return result("bills", [...base, supplier, ...optional("paid_date", "paid_amount")]);
  }
  // 3. A stock count as of a date.
  if (has.has("snapshot_date") && product && has.has("stock_on_hand"))
    return result("inventory_snapshot", ["snapshot_date", product, "stock_on_hand"]);
  // 4. A bank or cash ledger: dated signed amounts with a running balance, or with free text and no product or customer.
  const date = has.has("transaction_date") ? "transaction_date" : has.has("issue_date") ? "issue_date" : undefined;
  if (date && has.has("amount") && ctx.signedAmount) {
    if (has.has("balance")) return result("bank_cash", [date, "amount", "balance"]);
    if (has.has("description") && !product && !customer) return result("bank_cash", [date, "amount", "description"]);
  }
  // 5. A budget or plan: a period (or date) with an amount, and a name that says so.
  const periodOrDate = has.has("period") ? "period" : date;
  const money = has.has("amount") ? "amount" : has.has("measure") ? "measure" : undefined;
  const named = [...(ctx.names ?? []), ...roles.columns.map((c) => c.label)].some((n) => PLAN_WORD.test(n));
  if (periodOrDate && money && named) return result("budget_plan", [periodOrDate, money]);
  // 6. Rows already aggregated per period: a period role, or a date that with the dimensions is a unique key, and
  //    nothing that says one row is one order line.
  const lineLike = [...has].some((r) => ID_ROLES.has(r)) || hasLineIdentity(roles);
  if (!lineLike) {
    if (has.has("period")) return result("period_summary", ["period", ...optional(...MEASURE_ROLES)]);
    if (ctx.uniqueDateKey && [...has].some((r) => MEASURE_ROLES.has(r))) {
      return result("period_summary", ["transaction_date", ...optional(...MEASURE_ROLES)]);
    }
  }
  // 7. Sales lines: a date, an amount (or quantity and unit price) and something to attribute it to.
  const value = has.has("amount") ? ["amount"] : has.has("quantity") && has.has("unit_price") ? ["quantity", "unit_price"] : [];
  const who = [customer, product, has.has("order_id") ? "order_id" : undefined, has.has("channel") ? "channel" : undefined].filter(
    (x): x is string => x !== undefined,
  );
  if (date && value.length && who.length) return result("sales_lines", [date, ...value, ...who]);
  // 8. Anything else.
  return result("other", []);
}

/** Classify a loaded table: the context facts the rules need are measured in SQL (no number reaches a report from here). */
export async function classifyTable(
  ws: Workspace,
  roles: Pick<TableRoles, "table_id" | "columns" | "identities" | "period_parts">,
  profile: { readonly columns: readonly { readonly name: string; readonly min_value: string | null; readonly max_value: string | null }[] },
  names: readonly string[],
): Promise<KindResult> {
  const amount = columnsWith(roles, "amount")[0];
  const stats = amount ? profile.columns.find((c) => c.name === amount) : undefined;
  const signedAmount = stats ? Number(stats.min_value) < 0 && Number(stats.max_value) > 0 : false;
  const { date, dimensions } = keyColumns(roles);
  let uniqueDateKey = false;
  if (date) {
    const row = await ws.one<{ total: number; keys: number }>(uniqueKey(tableName(roles.table_id), date, dimensions));
    uniqueDateKey = Number(row?.total ?? 0) > 1 && Number(row?.total) === Number(row?.keys);
  }
  return classifyKind(roles, { names, signedAmount, uniqueDateKey });
}
