// Code validates every metric proposal (docs/specs/metric-layer.md §2.3). The model is never trusted to be
// right: each proposal is accepted (normalized, with defaults filled) or rejected with the reasons why.
import { MetricDef, type RatioTerm, screen } from "@agentic-analytics/schema";
import { type Catalog, type CatalogTable, DATE_TYPES, DIMENSION_TYPES, NUMERIC_TYPES } from "./catalog.ts";
import { describeExpr, type Expr, exprColumns, filterColumns, MetricLangError, parseExpression, parseFilter } from "./lang.ts";

export interface Rejected {
  readonly id?: string;
  readonly proposal: unknown;
  readonly reasons: string[];
}

export interface Validation {
  readonly accepted: MetricDef[];
  readonly rejected: Rejected[];
  /** Defaults the validator had to assume (e.g. a currency), to carry into the report as assumptions. */
  readonly assumptions: { readonly metric: string; readonly text: string }[];
}

export interface ValidateOptions {
  /** ISO 4217 code for money columns with no detected currency; "XXX" (no currency) when absent. */
  readonly defaultCurrency?: string;
  /** Keep each definition's `status` (loading a saved metrics file); otherwise every proposal is `assumed`. */
  readonly keepStatus?: boolean;
}

const parseOr = <T>(fn: () => T, reasons: string[], what: string): T | undefined => {
  try {
    return fn();
  } catch (err) {
    reasons.push(`${what}: ${err instanceof MetricLangError ? err.message : String(err)}`);
    return undefined;
  }
};

/** Checks a table-bound part (expression, filters, time column) and returns its expression AST. */
function checkTableTerm(
  table: CatalogTable | undefined,
  tableName: string,
  expression: string | undefined,
  filters: readonly string[] | undefined,
  needNumeric: boolean,
  reasons: string[],
  where: string,
): Expr | undefined {
  if (!table) {
    reasons.push(`${where}table "${tableName}" does not exist`);
    return undefined;
  }
  let expr: Expr | undefined;
  if (expression !== undefined) {
    expr = parseOr(() => parseExpression(expression), reasons, `${where}expression "${expression}"`);
    for (const c of expr ? exprColumns(expr) : []) {
      const col = table.columns.get(c);
      if (!col) reasons.push(`${where}column "${c}" does not exist in ${tableName}`);
      else if (needNumeric && !NUMERIC_TYPES.has(col.type))
        reasons.push(`${where}column "${c}" is ${col.type}, not a number, so it can't be summed or averaged`);
    }
  }
  for (const f of filters ?? []) {
    const ast = parseOr(() => parseFilter(f), reasons, `${where}filter "${f}"`);
    for (const c of ast ? filterColumns(ast) : [])
      if (!table.columns.has(c)) reasons.push(`${where}filter column "${c}" does not exist in ${tableName}`);
  }
  return expr;
}

export function validateMetrics(proposals: readonly unknown[], catalog: Catalog, options: ValidateOptions = {}): Validation {
  const accepted: MetricDef[] = [];
  const rejected: Rejected[] = [];
  const assumptions: Validation["assumptions"] = [];
  const seen = new Set<string>();

  // Table metrics first, then ratios (which may reference them), then derived metrics.
  const rank = (p: unknown) => {
    const t = (p as { type?: unknown })?.type;
    return t === "derived" ? 2 : t === "ratio" ? 1 : 0;
  };
  const ordered = proposals.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i);

  for (const { p } of ordered) {
    const reasons: string[] = [];
    const raw =
      typeof p === "object" && p !== null
        ? {
            ...(p as Record<string, unknown>),
            status: options.keepStatus && (p as { status?: unknown }).status === "confirmed" ? "confirmed" : "assumed",
          }
        : p;
    const id = typeof (raw as { id?: unknown })?.id === "string" ? ((raw as { id: string }).id as string) : undefined;
    let def: MetricDef | undefined;
    // Currency: fill from the column or the job default before the schema's "currency metrics need a currency" rule.
    const filled = fillCurrency(raw, catalog, options, assumptions);
    const parsed = MetricDef.safeParse(filled);
    if (!parsed.success) {
      reasons.push(...parsed.error.issues.map((i) => `${i.path.join(".") || "metric"}: ${i.message}`));
    } else {
      def = parsed.data;
      if (seen.has(def.id)) reasons.push(`id "${def.id}" is used by another metric`);
      reasons.push(...checkSemantics(def, catalog, accepted));
      // A definition names things the planner reads (its id, label and dimensions reach every prompt): one that
      // addresses a model is refused, and the reason doesn't repeat its text (security §3).
      if ([def.id, def.label, ...(def.dimensions ?? [])].some((t) => screen(t)))
        reasons.push("its id, label or a dimension reads as instructions to a model");
    }
    if (def && !reasons.length) {
      const table = def.table ? catalog.get(def.table) : undefined;
      const time = def.time_column ?? table?.dateColumn;
      accepted.push({ ...def, ...(time && def.type !== "ratio" && def.type !== "derived" ? { time_column: time } : {}) });
      seen.add(def.id);
    } else {
      rejected.push({ ...(id ? { id } : {}), proposal: p, reasons });
      assumptions.splice(0, assumptions.length, ...assumptions.filter((a) => a.metric !== id));
    }
  }
  return { accepted, rejected, assumptions };
}

function fillCurrency(raw: unknown, catalog: Catalog, options: ValidateOptions, assumptions: Validation["assumptions"]): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const r = raw as { id?: string; unit?: string; currency?: string; table?: string; expression?: string };
  if (r.unit !== "currency" || r.currency) return raw;
  let detected: string | undefined;
  try {
    const cols = r.expression ? exprColumns(parseExpression(r.expression)) : [];
    detected = cols.map((c) => (r.table ? catalog.get(r.table)?.columns.get(c)?.currency : undefined)).find(Boolean);
  } catch {
    detected = undefined;
  }
  const currency = detected ?? options.defaultCurrency ?? "XXX";
  if (!detected) {
    assumptions.push({
      metric: r.id ?? "",
      text: options.defaultCurrency
        ? `Amounts in ${r.id} are taken to be in ${currency} (no currency marked in the data).`
        : `The currency of ${r.id} is unknown (no currency marked in the data); amounts are shown without one.`,
    });
  }
  return { ...raw, currency };
}

function checkSemantics(def: MetricDef, catalog: Catalog, accepted: readonly MetricDef[]): string[] {
  const reasons: string[] = [];
  const byId = new Map(accepted.map((m) => [m.id, m]));

  if (def.type === "ratio") {
    for (const [side, t] of [
      ["numerator", def.numerator],
      ["denominator", def.denominator],
    ] as const) {
      if (!t) continue;
      if ("metric" in t) {
        if (!byId.has(t.metric)) reasons.push(`${side} metric "${t.metric}" is not a valid metric in this set`);
      } else {
        const table = catalog.get(t.table);
        checkTableTerm(table, t.table, t.expression, t.filters, true, reasons, `${side}: `);
        if (table && !table.dateColumn) reasons.push(`${side}: table "${t.table}" has no date column, so it can't be measured per period`);
      }
    }
    if (!reasons.length) {
      const same = selfRatio(def.numerator, def.denominator, byId, catalog);
      if (same) reasons.push(`ratio "${def.id}" divides "${same}" by itself (always 1)`);
    }
    if (def.unit !== "percent" && def.unit !== "ratio") reasons.push(`a ratio's unit must be percent or ratio, not ${def.unit}`);
    return reasons;
  }

  if (def.type === "derived") {
    const expr = parseOr(() => parseExpression(def.expression ?? ""), reasons, `expression "${def.expression}"`);
    for (const ref of expr ? exprColumns(expr) : []) {
      if (ref === def.id) reasons.push("a derived metric can't reference itself");
      else if (!byId.has(ref))
        reasons.push(`derived metric references "${ref}", which is not a valid metric in this set (or comes later: no cycles)`);
    }
    // "revenue / revenue" is always 1, like a ratio of a metric to itself (M13h).
    if (expr?.k === "bin" && expr.op === "/" && JSON.stringify(expr.left) === JSON.stringify(expr.right))
      reasons.push(`derived metric "${def.id}" divides "${describeExpr(expr.left)}" by itself (always 1)`);
    return reasons;
  }

  const table = def.table ? catalog.get(def.table) : undefined;
  const needNumeric = def.type === "sum" || def.type === "avg";
  checkTableTerm(table, def.table ?? "", def.expression, def.filters, needNumeric, reasons, "");
  if (!table) return reasons;
  if ((def.type === "sum" || def.type === "count" || def.type === "count_distinct") && def.unit === "percent") {
    reasons.push(`a ${def.type} of values can't be a percentage; use avg or a ratio`);
  }
  if ((def.type === "sum" || def.type === "avg") && def.expression && def.unit !== "currency") {
    const cols = parseOr(() => exprColumns(parseExpression(def.expression ?? "")), [], "") ?? [];
    if (cols.some((c) => table.columns.get(c)?.type === "currency"))
      reasons.push(`a ${def.type} of a money column must have unit currency, not ${def.unit}`);
  }
  if ((def.type === "count" || def.type === "count_distinct") && def.unit !== "count")
    reasons.push(`a ${def.type} metric's unit must be count, not ${def.unit}`);
  const time = def.time_column ?? table.dateColumn;
  if (!time) reasons.push(`table "${table.name}" has no date column, so the metric can't be measured per period`);
  else {
    const col = table.columns.get(time);
    if (!col) reasons.push(`time_column "${time}" does not exist in ${table.name}`);
    else if (!DATE_TYPES.has(col.type)) reasons.push(`time_column "${time}" is ${col.type}, not a date`);
  }
  for (const d of def.dimensions ?? []) {
    const col = table.columns.get(d);
    if (!col) reasons.push(`dimension "${d}" does not exist in ${table.name}`);
    else if (!DIMENSION_TYPES.has(col.type))
      reasons.push(`dimension "${d}" is ${col.type}; dimensions must be categories, labels, ids or dates`);
  }
  return reasons;
}

/** The AST of a filter or expression as text, so spacing and redundant parentheses don't make two terms differ. */
export const canonical = (text: string, parse: (t: string) => unknown): string => {
  try {
    return JSON.stringify(parse(text));
  } catch {
    return text.trim();
  }
};

/**
 * What a ratio term sums, as a comparable key: a referenced metric is resolved to its table term when it is a plain
 * sum over its table's date column (exactly what a table term compiles to), so `{table, expression, filters}` equal to
 * `{metric: revenue}` is caught too.
 */
export function termKey(t: RatioTerm, byId: ReadonlyMap<string, MetricDef>, catalog: Catalog): string {
  let table: string;
  let expression: string;
  let filters: readonly string[];
  if ("metric" in t) {
    const m = byId.get(t.metric);
    const plainSum =
      m?.type === "sum" &&
      m.table &&
      m.expression &&
      (m.time_column ?? catalog.get(m.table)?.dateColumn) === catalog.get(m.table)?.dateColumn;
    if (!m || !plainSum || !m.table || !m.expression) return `metric:${t.metric}`;
    table = m.table;
    expression = m.expression;
    filters = m.filters ?? [];
  } else {
    table = t.table;
    expression = t.expression;
    filters = t.filters ?? [];
  }
  const f = [...new Set(filters.map((x) => canonical(x, parseFilter)))].sort();
  return JSON.stringify([table, canonical(expression, parseExpression), f]);
}

/**
 * A ratio whose numerator and denominator are the same quantity is always 1 (or unknown): a drafting mistake, never a
 * metric (construction_supplier-v1, M13h). Returns how to name that quantity, or undefined when the sides differ.
 */
function selfRatio(
  n: RatioTerm | undefined,
  d: RatioTerm | undefined,
  byId: ReadonlyMap<string, MetricDef>,
  catalog: Catalog,
): string | undefined {
  if (!n || !d || termKey(n, byId, catalog) !== termKey(d, byId, catalog)) return undefined;
  const side = "metric" in n ? n : "metric" in d ? d : undefined;
  if (side) return side.metric;
  const t = n as Exclude<RatioTerm, { metric: string }>;
  const where = t.filters?.length ? ` where ${t.filters.map((f) => f.trim()).join(" and ")}` : "";
  return `sum(${t.expression}) of ${t.table}${where}`;
}
