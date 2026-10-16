// `agentic-analytics.metrics.yaml` (docs/specs/metric-layer.md §1, §3 "Reuse"): confirmed definitions saved
// for the next run. Pure text in and out; the caller does the file I/O.
import { type MetricDef, MetricFile } from "@agentic-analytics/schema";
import { parse, stringify } from "yaml";

export function metricsYaml(
  metrics: readonly MetricDef[],
  options: { grain?: MetricFile["grain"]; objective?: string; timezone?: string } = {},
): string {
  const file: MetricFile = {
    version: 1,
    grain: options.grain ?? "month",
    ...(options.timezone ? { timezone: options.timezone } : {}),
    ...(options.objective ? { objective: options.objective } : {}),
    metrics: [...metrics],
  };
  return stringify(file);
}

export function parseMetricsYaml(text: string): MetricFile {
  return MetricFile.parse(parse(text));
}
