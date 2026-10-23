// The fixed role vocabulary (docs/specs/semantics.md §1). The order is the spec's: it breaks score ties (§2.1).
// A test compares this list with the spec's table, so the two can't drift apart.
import { RoleError } from "./errors.ts";

export const ROLES = [
  "transaction_date",
  "issue_date",
  "due_date",
  "paid_date",
  "period",
  "snapshot_date",
  "order_id",
  "invoice_id",
  "line_id",
  "customer_id",
  "product_id",
  "supplier_id",
  "customer",
  "product",
  "product_group",
  "channel",
  "location",
  "supplier",
  "salesperson",
  "dimension",
  "amount",
  "quantity",
  "unit_price",
  "unit_cost",
  "cost_amount",
  "discount",
  "tax",
  "refund_amount",
  "paid_amount",
  "balance",
  "stock_on_hand",
  "count",
  "measure",
  "status",
  "currency",
  "description",
  "none",
] as const;

export type Role = (typeof ROLES)[number];

export const isRole = (s: string): s is Role => (ROLES as readonly string[]).includes(s);

/** Narrows a string to a role of the vocabulary, or throws UNKNOWN_ROLE. */
export function parseRole(s: string): Role {
  if (!isRole(s)) throw new RoleError("UNKNOWN_ROLE", `"${s}" is not a role of the vocabulary`);
  return s;
}

/** The position of a role in the vocabulary: the second tie-break (§2.1). */
export const roleOrder = (r: Role): number => ROLES.indexOf(r);
