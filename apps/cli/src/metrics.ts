// `aa metrics <paths…>`: ingest → profile → draft (model, else deterministic fallback) → validate → review →
// compile. Prints each metric in plain words with its SQL and recent values. Interactive by default; `--yes`
// keeps every definition as an assumption (docs/specs/metric-layer.md §3).
import { type InputFile, ingest } from "@agentic-analytics/ingest";
import {
  compileMetric,
  describeMetric,
  draftMetrics,
  loadCatalog,
  metricsYaml,
  parseMetricsYaml,
  type ReviewIO,
  reviewMetrics,
  runMetric,
  saveMetricDefs,
  validateMetrics,
} from "@agentic-analytics/metrics";
import type { ModelClient } from "@agentic-analytics/models";
import { profileJob } from "@agentic-analytics/profile";
import { Workspace } from "@agentic-analytics/store";

export interface MetricsOptions {
  readonly files: readonly InputFile[];
  readonly yes: boolean;
  readonly today: string;
  readonly currency?: string;
  /** Contents of a saved metrics file to reuse instead of drafting. */
  readonly metricsFile?: string;
  readonly lastPeriods?: number;
}

export interface MetricsDeps {
  readonly out: (line: string) => void;
  readonly io?: ReviewIO;
  readonly model?: ModelClient;
}

export interface MetricsOutcome {
  readonly yaml: string;
  readonly accepted: number;
  readonly rejected: number;
  readonly source: "model" | "fallback" | "file";
}

export async function runMetricsCommand(options: MetricsOptions, deps: MetricsDeps): Promise<MetricsOutcome> {
  const { out } = deps;
  const ws = await Workspace.open();
  try {
    const summary = await profileJob(ws, await ingest(options.files), { today: options.today });
    const catalog = await loadCatalog(ws);
    const validateOptions = options.currency ? { defaultCurrency: options.currency } : {};

    let drafts;
    let source: MetricsOutcome["source"];
    let rejected;
    if (options.metricsFile !== undefined) {
      const file = parseMetricsYaml(options.metricsFile);
      const v = validateMetrics(file.metrics, catalog, { ...validateOptions, keepStatus: true });
      drafts = v.accepted;
      rejected = v.rejected;
      source = "file" as const;
      out(`Loaded ${drafts.length} metric(s) from the metrics file.`);
    } else {
      const draft = await draftMetrics(summary, catalog, { ...validateOptions, ...(deps.model ? { model: deps.model } : {}) });
      drafts = draft.validation.accepted;
      rejected = draft.validation.rejected;
      source = draft.source;
      out(
        `Drafted ${drafts.length} metric(s) (${draft.source === "model" ? "model" : "deterministic fallback"}).${draft.note ? ` Note: ${draft.note}.` : ""}`,
      );
      for (const a of draft.validation.assumptions) out(`  assumption: ${a.text}`);
    }
    for (const r of rejected) out(`  rejected ${r.id ?? "(no id)"}: ${r.reasons.join("; ")}`);

    const reviewed = await reviewMetrics(drafts, catalog, options.yes ? undefined : deps.io, {
      ...validateOptions,
      yes: options.yes,
      grain: summary.grain,
    });
    for (const d of reviewed.dropped) out(`  dropped ${d.id}: ${d.reason}`);

    const periods = summary.tables
      .flatMap((t) => (t.date_first && t.date_last ? [t.date_first.slice(0, 7), t.date_last.slice(0, 7)] : []))
      .sort();
    const range = { from: periods[0] ?? "0000-01", to: periods[periods.length - 1] ?? "9999-12" };
    await saveMetricDefs(ws, reviewed.metrics, catalog, range);

    out("");
    for (const m of reviewed.metrics) {
      out(describeMetric(m, reviewed.metrics, summary.grain));
      const compiled = compileMetric(m.id, reviewed.metrics, catalog, range);
      out(`  sql: ${compiled.text.replace(/\s+/g, " ").slice(0, 400)}`);
      out(`  params: ${JSON.stringify(compiled.params)}`);
      const rows = await runMetric(ws, m.id, reviewed.metrics, catalog, range);
      const recent = rows.slice(-(options.lastPeriods ?? 6));
      out(`  ${recent.map((r) => `${r.period} ${r.value === null ? "–" : Number(r.value.toFixed(4))}`).join(" · ")}`);
    }
    return {
      yaml: metricsYaml(reviewed.metrics, { grain: summary.grain }),
      accepted: reviewed.metrics.length,
      rejected: rejected.length,
      source,
    };
  } finally {
    ws.close();
  }
}
