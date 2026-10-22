// Metric YAML (docs/specs/metric-layer.md §1), compatible with Apache Ossie metric concepts.
import { z } from "zod";

const ident = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case identifier");

export const MetricType = z.enum(["sum", "count", "count_distinct", "avg", "ratio", "derived"]);
export const MetricUnit = z.enum(["currency", "percent", "count", "ratio", "days", "other"]);
export const Grain = z.enum(["day", "week", "month", "quarter", "year"]);
export type Grain = z.infer<typeof Grain>;

/** One side of a ratio: an inline aggregate over a table, or a reference to another metric. */
export const RatioTerm = z.union([
  z.object({ table: z.string(), expression: z.string(), filters: z.array(z.string()).optional() }).strict(),
  z.object({ metric: ident }).strict(),
]);
export type RatioTerm = z.infer<typeof RatioTerm>;

export const MetricDef = z
  .object({
    id: ident,
    label: z.string(),
    description: z.string().optional(),
    type: MetricType,
    table: z.string().optional(),
    expression: z.string().optional(),
    filters: z.array(z.string()).optional(),
    numerator: RatioTerm.optional(),
    denominator: RatioTerm.optional(),
    time_column: z.string().optional(),
    unit: MetricUnit,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    dimensions: z.array(z.string()).optional(),
    status: z.enum(["confirmed", "assumed"]),
  })
  .superRefine((m, ctx) => {
    if (m.type === "ratio") {
      if (!m.numerator || !m.denominator) ctx.addIssue({ code: "custom", message: "ratio metrics need numerator and denominator" });
    } else if (m.type === "derived") {
      if (!m.expression) ctx.addIssue({ code: "custom", message: "derived metrics need an expression over other metrics" });
    } else {
      if (!m.table) ctx.addIssue({ code: "custom", message: `${m.type} metrics need a table`, path: ["table"] });
      if (m.type !== "count" && !m.expression)
        ctx.addIssue({ code: "custom", message: `${m.type} metrics need an expression`, path: ["expression"] });
    }
    if (m.unit === "currency" && !m.currency)
      ctx.addIssue({ code: "custom", message: "currency metrics need an ISO 4217 currency", path: ["currency"] });
  });

export const MetricFile = z.object({
  version: z.literal(1),
  grain: Grain,
  timezone: z.string().optional(),
  objective: z.string().optional(),
  entities: z.array(z.object({ id: ident, source: z.string() })).optional(),
  metrics: z.array(MetricDef),
});

export type MetricDef = z.infer<typeof MetricDef>;
export type MetricFile = z.infer<typeof MetricFile>;
