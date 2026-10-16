// Plain-language rendering of a metric for the confirmation step (docs/specs/metric-layer.md §3):
// "Revenue = sum of amount where status is not refunded, per month, in USD".
import type { MetricDef } from "@agentic-analytics/schema";
import { describeExpr, describeFilter, parseExpression, parseFilter } from "./lang.ts";

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

function where(filters: readonly string[] | undefined): string {
  // Filters are AND-ed; an OR filter among several is bracketed so "(a or b) and c" can't read as "a or (b and c)".
  const many = (filters ?? []).length > 1;
  const parts = (filters ?? []).map((f) =>
    safe(() => {
      const ast = parseFilter(f);
      const text = describeFilter(ast);
      return many && ast.k === "or" ? `(${text})` : text;
    }, f),
  );
  return parts.length ? ` where ${parts.join(" and ")}` : "";
}

function aggregate(type: MetricDef["type"], expression: string | undefined): string {
  const e = expression ? safe(() => describeExpr(parseExpression(expression)), expression) : "";
  switch (type) {
    case "sum":
      return `sum of ${e}`;
    case "avg":
      return `average of ${e}`;
    case "count":
      return e ? `number of rows with ${e}` : "number of rows";
    case "count_distinct":
      return `number of distinct ${e}`;
    default:
      return e;
  }
}

export function describeMetric(def: MetricDef, all: readonly MetricDef[] = [], grain = "month"): string {
  const label = (id: string) => all.find((m) => m.id === id)?.label ?? id;
  const per = `, per ${grain}`;
  const unit =
    def.unit === "currency" && def.currency
      ? def.currency === "XXX"
        ? ", currency unknown"
        : `, in ${def.currency}`
      : def.unit === "percent"
        ? ", as a percentage"
        : "";
  let body: string;
  if (def.type === "ratio") {
    const term = (t: unknown) => {
      const x = t as { metric: string } | { expression: string; filters?: string[] };
      return "metric" in x ? label(x.metric) : `${aggregate("sum", x.expression)}${where(x.filters)}`;
    };
    body = `${term(def.numerator)} ÷ ${term(def.denominator)}`;
  } else if (def.type === "derived") {
    body = safe(() => describeExpr(parseExpression(def.expression ?? "")), def.expression ?? "");
  } else {
    body = `${aggregate(def.type, def.expression)}${where(def.filters)}`;
  }
  const status = def.status === "assumed" ? " (assumed)" : "";
  return `${def.label} = ${body}${per}${unit}${status}`;
}
