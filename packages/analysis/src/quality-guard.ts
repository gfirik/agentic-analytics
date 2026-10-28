// Changes caused by a known data error are not business findings (analysis-library §3, "Data-quality findings come
// from profiling"). A cell flagged as a unit error (×10, ×100, ×1000) makes every metric computed from its column —
// directly, through a ratio term, or through a derived metric — jump in that period and back. Such insights are
// withheld from ranking; the report keeps the data-quality item and an open question says what was withheld.
// Found by the first real-model runs (M11/M12): a model drafted a "packaging cost" metric over the costs sheet and
// the planted ×1000 typo became every top finding.
import type { MetricDef } from "@agentic-analytics/schema";
import { ident, sql, tableName, type Workspace } from "@agentic-analytics/store";
import type { Insight } from "./templates.ts";

export interface Flagged {
  /** Periods whose value is distorted by a flagged cell. */
  readonly periods: ReadonlySet<string>;
  /** The data-quality message, for the open question. */
  readonly why: string;
}

const mentions = (expression: string | undefined, column: string) =>
  expression !== undefined && new RegExp(`(^|[^A-Za-z0-9_])${column.replace(/[^A-Za-z0-9_]/g, "")}([^A-Za-z0-9_]|$)`).test(expression);

/** Per metric id: the periods distorted by unit-error cells in the columns it reads. */
export async function flaggedPeriods(ws: Workspace, defs: readonly MetricDef[]): Promise<Map<string, Flagged>> {
  const issues = await ws.all<{ source_id: string | null; column_name: string | null; rows: number[] | null; message: string }>(
    sql`SELECT source_id, column_name, rows, message FROM quality_issues WHERE kind = 'unit_error' AND rows IS NOT NULL`,
  );
  const out = new Map<string, { periods: Set<string>; why: string }>();
  const add = (id: string, periods: Iterable<string>, why: string) => {
    const f = out.get(id) ?? { periods: new Set<string>(), why };
    for (const p of periods) f.periods.add(p);
    out.set(id, f);
  };
  for (const q of issues) {
    if (!q.source_id || !q.column_name || !q.rows?.length || !/^T\d+$/.test(q.source_id)) continue;
    const table = tableName(q.source_id);
    const periods = (
      await ws.all<{ p: string | null }>(
        sql`SELECT DISTINCT _period AS p FROM ${ident(table)} WHERE list_contains(${JSON.stringify(q.rows)}::INTEGER[], _row)`,
      )
    ).flatMap((r) => (r.p ? [r.p] : []));
    if (!periods.length) continue;
    const column = q.column_name;
    const reads = (t: { table?: string | undefined; expression?: string | undefined } | undefined) =>
      t?.table === table && mentions(t.expression, column);
    for (const d of defs) {
      const terms = d.type === "ratio" ? [d.numerator, d.denominator].map((t) => (t && "table" in t ? t : undefined)) : [];
      if (reads(d) || terms.some(reads)) add(d.id, periods, q.message);
    }
  }
  // Metrics built from a flagged metric (ratio terms by id, derived expressions) inherit its periods.
  for (let changed = true; changed; ) {
    changed = false;
    for (const d of defs) {
      if (out.has(d.id)) continue;
      const refs = [
        ...(d.type === "ratio" ? [d.numerator, d.denominator].flatMap((t) => (t && "metric" in t ? [t.metric] : [])) : []),
        ...(d.type === "derived" ? defs.filter((x) => x.id !== d.id && mentions(d.expression, x.id)).map((x) => x.id) : []),
      ];
      const hit = refs.map((r) => out.get(r)).find((f) => f !== undefined);
      if (hit) {
        add(d.id, hit.periods, hit.why);
        changed = true;
      }
    }
  }
  return out;
}

/**
 * True when the insight reports a flagged period or uses one anywhere in its computation: a role, or an input of
 * any of its calcs (a before-mean or trailing baseline that averages in the distorted period counts too).
 */
export function touchesFlagged(insight: Insight, flagged: ReadonlyMap<string, Flagged>): boolean {
  const f = flagged.get(insight.metric);
  if (!f) return false;
  if (f.periods.has(insight.period)) return true;
  const refs = [...Object.values(insight.roles), ...insight.calcs.flatMap((c) => c.inputs)];
  // A concentration statistic over a window that holds a flagged period reads the distorted value.
  return refs.some(
    (r) => (r.kind === "point" && f.periods.has(r.period)) || (r.kind === "stat" && [...f.periods].some((p) => p >= r.from && p <= r.to)),
  );
}
