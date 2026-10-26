// The columns a metric reads, for the report's role assumptions (metric-layer §3 "Recording"): a role that no metric
// reads is not an assumption anything rests on.
import type { MetricDef } from "@agentic-analytics/schema";
import { exprColumns, filterColumns, parseExpression, parseFilter } from "./lang.ts";

export interface ColumnRef {
  readonly table: string;
  readonly column: string;
}

const safe = (f: () => string[]): string[] => {
  try {
    return f();
  } catch {
    // A definition that does not parse was refused by validation already; it reads nothing here.
    return [];
  }
};

/** Every (table, column) the definition reads: expression, filters, time column, dimensions, and ratio terms (following metric references). */
export function metricColumns(def: MetricDef, all: readonly MetricDef[] = [], depth = 0): ColumnRef[] {
  const out: ColumnRef[] = [];
  const read = (table: string | undefined, expression?: string, filters?: readonly string[]) => {
    if (!table) return;
    const cols = [
      ...(expression ? safe(() => exprColumns(parseExpression(expression))) : []),
      ...(filters ?? []).flatMap((f) => safe(() => filterColumns(parseFilter(f)))),
    ];
    for (const column of cols) out.push({ table, column });
  };
  read(def.table, def.type === "derived" ? undefined : def.expression, def.filters);
  if (def.table) {
    if (def.time_column) out.push({ table: def.table, column: def.time_column });
    for (const column of def.dimensions ?? []) out.push({ table: def.table, column });
  }
  for (const term of [def.numerator, def.denominator]) {
    if (!term) continue;
    if ("metric" in term) {
      const ref = all.find((m) => m.id === term.metric);
      if (ref && depth < 5) out.push(...metricColumns(ref, all, depth + 1));
    } else read(term.table, term.expression, term.filters);
  }
  // A derived metric reads what the metrics in its expression read (gross_margin = revenue - cost reads the cost column).
  if (def.type === "derived" && def.expression && depth < 5)
    for (const id of safe(() => exprColumns(parseExpression(def.expression ?? "")))) {
      const ref = all.find((m) => m.id === id);
      if (ref) out.push(...metricColumns(ref, all, depth + 1));
    }
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.table}/${r.column}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
