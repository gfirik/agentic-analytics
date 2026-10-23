// The hand role labels (docs/specs/accuracy.md §11, docs/specs/semantics.md §1 and §3): one answer per column of each
// dataset's tables, written before any detector existed. The 30 generated businesses share two header layouts, so
// their labels are written once per layout and expanded per dataset here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { EvalRunError } from "./errors.ts";

/** The role vocabulary of semantics.md §1; a test compares this list with the spec's table. */
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
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

/** The table kinds of semantics.md §3. */
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
export const TableKind = z.enum(TABLE_KINDS);
export type TableKind = z.infer<typeof TableKind>;

const Column = z
  .object({
    /** The header exactly as the file spells it. */
    header: z.string().min(1),
    role: Role,
    /** Other roles that are also right where two genuinely are. */
    accept: z.array(Role).default([]),
    /** Whether the independent re-labelling agreed on the first pass (the review block says who and when). */
    agrees: z.boolean().optional(),
    /** Why a disagreement was settled the way it was, or why two roles are both accepted. */
    note: z.string().optional(),
  })
  .refine((c) => !c.accept.includes(c.role), { message: "accept repeats the column's own role" });

const Review = z.object({
  reviewed_by: z.string().min(1),
  date: z.iso.date(),
  /** Columns the independent labeller labelled / agreed on (first pass, before settling), for this entry. */
  columns: z.number().int().nonnegative(),
  agreed: z.number().int().nonnegative(),
  /** The table kind: whether the independent labeller's kind agreed. */
  kind_agrees: z.boolean(),
});

const Entry = z.object({
  id: z.string().min(1),
  /** real: a public file; generated: the 30 businesses (one entry per layout); synthetic: committed datasets. */
  group: z.enum(["real", "generated", "synthetic"]),
  datasets: z.array(z.string().min(1)).min(1),
  /** The table's name: a file name for a CSV, a sheet name for a workbook. */
  table: z.string().min(1),
  kind: TableKind,
  columns: z.array(Column).min(1),
  review: Review.optional(),
});

export const RoleLabels = z
  .object({ version: z.literal(1), entries: z.array(Entry).min(1) })
  .superRefine((l, ctx) => {
    const ids = new Set<string>();
    for (const [i, e] of l.entries.entries()) {
      if (ids.has(e.id)) ctx.addIssue({ code: "custom", path: ["entries", i, "id"], message: `duplicate entry ${e.id}` });
      ids.add(e.id);
      const seen = new Set<string>();
      for (const [j, c] of e.columns.entries()) {
        if (seen.has(c.header))
          ctx.addIssue({ code: "custom", path: ["entries", i, "columns", j, "header"], message: `duplicate header ${c.header} in ${e.id}` });
        seen.add(c.header);
      }
    }
  });
export type RoleLabels = z.infer<typeof RoleLabels>;
export type RoleLabelEntry = RoleLabels["entries"][number];

/** evals/roles/labels.yaml in a checkout. */
export const ROLE_LABELS_FILE = join(import.meta.dirname, "..", "..", "roles", "labels.yaml");

export function parseRoleLabels(text: string): RoleLabels {
  const parsed = RoleLabels.safeParse(parse(text));
  if (!parsed.success)
    throw new EvalRunError(
      "BAD_RESULTS",
      `invalid role labels: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  return parsed.data;
}

export function loadRoleLabels(file: string = ROLE_LABELS_FILE): RoleLabels {
  return parseRoleLabels(readFileSync(file, "utf8"));
}

/** One dataset's labelled table, after expanding the shared layouts. */
export interface DatasetTableLabels {
  readonly dataset: string;
  readonly entry: string;
  readonly group: RoleLabelEntry["group"];
  readonly table: string;
  readonly kind: TableKind;
  readonly columns: RoleLabelEntry["columns"];
}

/** Every (dataset, table) the labels cover, in file order; a layout shared by 30 datasets gives 30 tables. */
export function expandRoleLabels(l: RoleLabels): DatasetTableLabels[] {
  return l.entries.flatMap((e) =>
    e.datasets.map((dataset) => ({ dataset, entry: e.id, group: e.group, table: e.table, kind: e.kind, columns: e.columns })),
  );
}

export interface LabelCounts {
  /** Every column of every dataset, as the acceptance counts them. */
  readonly columns: number;
  readonly byGroup: Readonly<Record<string, number>>;
  /** Distinct (layout, column) pairs: the shared layouts count once. */
  readonly distinct: number;
  readonly tables: number;
  /** Columns whose label is `none`, and those with a non-empty accept list. */
  readonly none: number;
  readonly withAccept: number;
}

export function countRoleLabels(l: RoleLabels): LabelCounts {
  const byGroup: Record<string, number> = {};
  let columns = 0;
  let none = 0;
  let withAccept = 0;
  let tables = 0;
  for (const t of expandRoleLabels(l)) {
    tables++;
    columns += t.columns.length;
    byGroup[t.group] = (byGroup[t.group] ?? 0) + t.columns.length;
    none += t.columns.filter((c) => c.role === "none").length;
    withAccept += t.columns.filter((c) => c.accept.length > 0).length;
  }
  return { columns, byGroup, distinct: l.entries.reduce((n, e) => n + e.columns.length, 0), tables, none, withAccept };
}

/**
 * Checks a labelled table against the headers the dataset really has: the same set, spelled the same. Returns the
 * differences (empty when they agree), so a test can print what drifted.
 */
export function headerDifferences(t: DatasetTableLabels, actual: readonly string[]): string[] {
  const labelled = t.columns.map((c) => c.header);
  const out: string[] = [];
  for (const h of labelled) if (!actual.includes(h)) out.push(`${t.dataset}/${t.table}: labelled column "${h}" is not in the file`);
  for (const h of actual) if (!labelled.includes(h)) out.push(`${t.dataset}/${t.table}: column "${h}" has no label`);
  return out;
}
