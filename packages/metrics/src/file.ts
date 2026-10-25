// `agentic-analytics.metrics.yaml` (docs/specs/metric-layer.md §1, §3 "Reuse"): confirmed definitions saved
// for the next run. Pure text in and out; the caller does the file I/O.
import { ConfirmFile, type MetricDef, MetricFile, type RoleEntry } from "@agentic-analytics/schema";
import { parse, stringify } from "yaml";

export function metricsYaml(
  metrics: readonly MetricDef[],
  options: {
    grain?: MetricFile["grain"];
    objective?: string;
    timezone?: string;
    /** From M15: the columns' roles and the business model, written after the metrics (metric-layer §1). */
    roles?: readonly RoleEntry[];
    business_model?: MetricFile["business_model"];
  } = {},
): string {
  const file: MetricFile = {
    version: 1,
    grain: options.grain ?? "month",
    ...(options.timezone ? { timezone: options.timezone } : {}),
    ...(options.objective ? { objective: options.objective } : {}),
    metrics: [...metrics],
    ...(options.roles ? { roles: [...options.roles] } : {}),
    ...(options.business_model ? { business_model: options.business_model } : {}),
  };
  return stringify(file);
}

export function parseMetricsYaml(text: string): MetricFile {
  return MetricFile.parse(parse(text));
}

/** A confirmation body: like a metrics file, but `metrics` may be left out to revise only the roles (interfaces §1). */
export function parseConfirmYaml(text: string): ConfirmFile {
  return ConfirmFile.parse(parse(text));
}

/** A roles-only confirmation body: no `metrics:`, so the job keeps waiting and the metrics are drafted again from the roles. */
export function rolesYaml(
  roles: readonly RoleEntry[],
  options: { grain?: MetricFile["grain"]; business_model?: MetricFile["business_model"] } = {},
): string {
  return stringify({
    version: 1,
    grain: options.grain ?? "month",
    roles: [...roles],
    ...(options.business_model ? { business_model: options.business_model } : {}),
  });
}
