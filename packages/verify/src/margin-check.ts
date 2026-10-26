// V4 for margin (agent-and-verifier §7): a claim that names margin must read a cost role, and a margin function fact must
// be built from its definition's two terms for the same period and member. Deterministic; no model.
import { type Catalog, marginTerms, metricColumns } from "@agentic-analytics/metrics";
import type { Fact, MetricDef } from "@agentic-analytics/schema";
import { sql, type Workspace } from "@agentic-analytics/store";

/** The margin lexicon: EN margin, gross profit, markup; RU маржа, маржинальность, валовая прибыль; UZ marja, yalpi foyda. */
const MARGIN_WORDS =
  /(?<![\p{L}])(?:margins?|gross\s+profits?|markups?|маржа|маржи|маржу|маржой|маржинальн\p{L}*|валов\p{L}*\s+прибыл\p{L}*|marja\p{L}*|yalpi\s+foyda\p{L}*)(?![\p{L}])/iu;

export const namesMargin = (text: string): boolean => MARGIN_WORDS.test(text);

/**
 * The ids of the metrics whose definition reads a column with a cost role (`unit_cost` or `cost_amount`), directly or
 * through the metrics it is built from. A role the user dropped is stored as `none`, so it counts for nothing.
 */
export async function costRoleMetrics(ws: Workspace, defs: readonly MetricDef[], catalog: Catalog): Promise<Set<string>> {
  const rows = await ws.all<{ table_id: string; column_name: string }>(
    sql`SELECT table_id, column_name FROM profile_roles WHERE role IN ('unit_cost', 'cost_amount')`,
  );
  const cost = new Set(rows.map((r) => `${r.table_id}/${r.column_name}`));
  if (!cost.size) return new Set();
  const reads = (def: MetricDef) => metricColumns(def, defs).some((c) => cost.has(`${catalog.get(c.table)?.id ?? c.table}/${c.column}`));
  return new Set(defs.filter(reads).map((d) => d.id));
}

/**
 * A claim that names margin must come from a metric that reads a cost role: at least one of its facts, followed back
 * through its inputs (`metricsOf`), is measured from one. A margin claim on a table with no cost role, or on a cost column
 * the user dropped, is a violation, and the claim is dropped (V4).
 */
export function marginClaimProblem(
  text: string,
  facts: readonly string[],
  metricsOf: (factId: string) => ReadonlySet<string>,
  costMetrics: ReadonlySet<string>,
): string | undefined {
  if (!namesMargin(text)) return undefined;
  const measured = facts.flatMap((id) => [...metricsOf(id)]);
  return measured.some((m) => costMetrics.has(m))
    ? undefined
    : "the claim names margin but none of its facts is measured from a cost column (no cost role)";
}

/** What follows a fact's metric id in its label: the member and period, which a margin fact shares with its inputs. */
const scope = (f: Fact) => f.label.slice((f.metric_id ?? "").length);

/**
 * A margin function fact (`gross_margin`, `gross_margin_pct`) must be built from its definition's terms: the revenue term
 * and the cost metric, in that order, of the same period and member (analysis-library §9).
 */
export function marginFactProblem(f: Fact, all: ReadonlyMap<string, Fact>, defs: readonly MetricDef[]): string | undefined {
  const fn = f.computation.fn;
  if (f.computation.kind !== "function" || (fn !== "gross_margin" && fn !== "gross_margin_pct")) return undefined;
  const def = defs.find((d) => d.id === f.metric_id);
  const terms = def ? marginTerms(def, defs) : undefined;
  if (!def || !terms || terms.fn !== fn) return `fact ${f.id} is a ${fn} fact but is not the value of a margin definition`;
  const [revenue, cost] = (f.computation.inputs ?? []).map((id) => all.get(id));
  const ok =
    f.computation.inputs?.length === 2 &&
    revenue?.metric_id === terms.revenue &&
    cost?.metric_id === terms.cost &&
    scope(revenue) === scope(f) &&
    scope(cost) === scope(f);
  return ok ? undefined : `fact ${f.id} is not built from ${terms.revenue} and ${terms.cost} of its own period and member`;
}
