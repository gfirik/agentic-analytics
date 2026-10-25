// Business-model inference (docs/specs/semantics.md §4): retail, wholesale, subscription, services or unknown, from the
// tables' kinds and roles and a few shares measured in SQL. It is an assumption, never a number in a claim; it only
// decides which packs run first. The first signal in the spec's order that holds decides.
import { tableName, type Workspace } from "@agentic-analytics/store";
import { channelShare, missingShare, steadyShare, topTenShare } from "./business.sql.ts";
import type { TableRoles } from "./detect.ts";
import { columnsWith, type KindResult } from "./kinds.ts";

export const BUSINESS_MODELS = ["retail", "wholesale", "subscription", "services", "unknown"] as const;
export type BusinessModelName = (typeof BUSINESS_MODELS)[number];

/** A measured share, stored as an SQL fact (`business_model.<signal>`, unit percent). */
export interface ModelFact {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly sql: { readonly text: string; readonly params: readonly (string | number | boolean | null | bigint)[] };
}

export interface ModelSignal {
  /** Readable, no numerals; `{{key}}` is replaced by the signal's fact when it becomes a report. */
  readonly text: string;
  readonly fact?: ModelFact;
  readonly holds: boolean;
}

export interface BusinessModel {
  readonly model: BusinessModelName;
  readonly table_id?: string;
  readonly signals: readonly ModelSignal[];
  /** `confirmed` once a person set or accepted it on the confirm screen (semantics §5); absent means an assumption. */
  readonly status?: "confirmed" | "assumed";
}

export interface ModelTable {
  readonly kind: KindResult;
  readonly roles: Pick<TableRoles, "table_id" | "columns">;
  readonly detail_rows: number;
  /** The table's date column from profiling, when no role names one. */
  readonly date_column?: string | undefined;
}

const HALF = 50;
const WHOLESALE = "wholesale|b2b|опт|ulgurji";
const RETAIL = "retail|store|розниц|chakana";
const MISSING_CUSTOMER = 20;

export async function inferBusinessModel(ws: Workspace, tables: readonly ModelTable[]): Promise<BusinessModel> {
  // The largest sales-lines table; an invoices register stands in when there is none.
  const pick = (kind: string) => tables.filter((t) => t.kind.kind === kind).sort((a, b) => b.detail_rows - a.detail_rows)[0];
  const main = pick("sales_lines") ?? pick("invoices");
  if (!main) return { model: "unknown", signals: [] };
  const id = main.roles.table_id;
  const table = tableName(id);
  const amount = columnsWith(main.roles, "amount")[0];
  const date = columnsWith(main.roles, "transaction_date", "issue_date")[0] ?? main.date_column;
  const customer = columnsWith(main.roles, "customer_id")[0] ?? columnsWith(main.roles, "customer")[0];
  const channel = columnsWith(main.roles, "channel")[0];
  const signals: ModelSignal[] = [];
  const fact = async (
    key: string,
    label: string,
    q: { text: string; params: readonly never[] | readonly (string | number | boolean | null | bigint)[] },
  ) => {
    const row = await ws.one<{ value: number | null }>({ text: q.text, params: q.params as never });
    return {
      key: `business_model.${key}.${id}`,
      label,
      value: Number(row?.value ?? 0),
      sql: { text: q.text, params: q.params },
    } satisfies ModelFact;
  };
  const done = (model: BusinessModelName): BusinessModel => ({ model, table_id: id, signals });

  // 1. Subscription: steady customers hold at least half of the last year's revenue.
  if (amount && date && customer) {
    const f = await fact("subscription_steady", "revenue share of customers billed steadily", steadyShare(table, date, amount, customer));
    const holds = f.value >= HALF;
    signals.push({
      text: "customers billed in steady amounts for months in a row hold {{" + f.key + "}} of the last year's revenue",
      fact: f,
      holds,
    });
    if (holds) return done("subscription");
  }
  // 2. Wholesale: a wholesale channel, or a few customers, hold at least half of the last year's revenue.
  if (amount && date && channel) {
    const f = await fact("wholesale_channel", "revenue share of wholesale channels", channelShare(table, date, amount, channel, WHOLESALE));
    const holds = f.value >= HALF;
    signals.push({ text: "wholesale channels hold {{" + f.key + "}} of the last year's revenue", fact: f, holds });
    if (holds) return done("wholesale");
  }
  if (amount && date && customer) {
    const f = await fact("wholesale_top10", "revenue share of the ten largest customers", topTenShare(table, date, amount, customer));
    const holds = f.value >= HALF;
    signals.push({ text: "the ten largest customers hold {{" + f.key + "}} of the last year's revenue", fact: f, holds });
    if (holds) return done("wholesale");
  }
  // 3. Retail: a retail channel holds at least half, or many sales rows have no customer.
  if (amount && date && channel) {
    const f = await fact("retail_channel", "revenue share of retail channels", channelShare(table, date, amount, channel, RETAIL));
    const holds = f.value >= HALF;
    signals.push({ text: "retail channels hold {{" + f.key + "}} of the last year's revenue", fact: f, holds });
    if (holds) return done("retail");
  }
  if (customer) {
    const f = await fact("retail_no_customer", "share of sales rows with no customer", missingShare(table, customer));
    const holds = f.value >= MISSING_CUSTOMER;
    signals.push({ text: "{{" + f.key + "}} of the sales rows name no customer", fact: f, holds });
    if (holds) return done("retail");
  } else {
    signals.push({ text: "the sales table has no customer column", holds: true });
    return done("retail");
  }
  // 4. Services: sales with neither a quantity nor a product.
  const roles = new Set(main.roles.columns.map((c) => c.role));
  const noItems = main.kind.kind === "sales_lines" && !roles.has("quantity") && !roles.has("product") && !roles.has("product_id");
  if (noItems) {
    signals.push({ text: "the sales rows carry neither a quantity nor a product", holds: true });
    return done("services");
  }
  return done("unknown");
}
