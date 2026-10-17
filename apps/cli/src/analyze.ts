// `aa analyze <paths…>` (interfaces §2): a full job through the job manager, as the API and MCP run it, with a live
// stage view and, without --yes, an interactive review of the drafted metrics. The report lands in
// `<out>/agentic-analytics/`.
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { type JobManager, type JobOptions, ManagerError } from "@agentic-analytics/core";
import type { InputFile } from "@agentic-analytics/ingest";
import { metricsYaml, parseMetricsYaml, type ReviewChoice } from "@agentic-analytics/metrics";
import { reportSummaryText } from "@agentic-analytics/report";
import type { MetricDef } from "@agentic-analytics/schema";
import { ReviewEndedError, reviewEndedLines } from "./prompt.ts";
import { formatEvent } from "./run.ts";

/** What the metric review asks a person (a terminal, or a script in tests). */
export interface ReviewPrompt {
  show(line: string): void;
  choose(question: string): Promise<ReviewChoice>;
  /** Returns the edited YAML of one metric (a `metrics:` file with that one entry, or the entry alone). */
  edit(yaml: string): Promise<string>;
}

export interface AnalyzeInput {
  readonly files: readonly InputFile[];
  readonly options: JobOptions;
  /** Folder the report is copied into (`<out>/agentic-analytics/`). */
  readonly out: string;
  readonly jobId?: string;
}

export interface AnalyzeDeps {
  readonly manager: JobManager;
  readonly print: (line: string) => void;
  /** Present unless --yes: the job pauses for review. */
  readonly review?: ReviewPrompt;
}

export interface AnalyzeResult {
  readonly code: number;
  readonly jobId: string;
  readonly reportPath?: string;
  readonly htmlPath?: string;
}

/** One pass over the drafted metrics: accept, edit or drop each; returns the YAML to confirm. */
async function reviewOnce(yaml: string, review: ReviewPrompt, texts: readonly string[]): Promise<string> {
  const file = parseMetricsYaml(yaml);
  const grain = file.grain;
  const kept: MetricDef[] = [];
  for (const [i, d] of file.metrics.entries()) {
    review.show("");
    review.show(texts[i] ?? d.id);
    const choice = await review.choose(`Metric ${d.id}?`);
    if (choice === "drop") continue;
    if (choice === "edit") {
      const edited = await review.edit(metricsYaml([d], { grain }));
      // A whole metrics file, or one entry typed on its own.
      const text = /^\s*metrics\s*:/m.test(edited) ? edited : `version: 1\ngrain: ${grain}\nmetrics:\n${edited.replace(/^/gm, "  ")}`;
      kept.push(...parseMetricsYaml(text).metrics);
      continue;
    }
    kept.push(d);
  }
  return metricsYaml(kept, { grain });
}

export async function analyzeCommand(input: AnalyzeInput, deps: AnalyzeDeps): Promise<AnalyzeResult> {
  const { manager, print } = deps;
  const s = await manager.create(input.files, { ...input.options, autoConfirm: !deps.review }, input.jobId);
  const id = s.job_id;
  print(`job ${id}`);
  const unsubscribe = await manager.subscribe(id, (e) => {
    const line = formatEvent(e);
    if (line) print(line);
    if (e.type === "progress" && e.message) print(`  … ${e.message}`);
  });
  try {
    let status = await manager.wait(id);
    while (status.status === "awaiting_confirmation" && deps.review) {
      const m = await manager.metrics(id);
      print("");
      print("Review the drafted metric definitions. Every number in the report is computed from them.");
      let yaml: string;
      try {
        yaml = await reviewOnce(
          m.yaml,
          deps.review,
          m.metrics.map((x) => x.text),
        );
      } catch (err) {
        // The input ended (piped answers ran out, or stdin is closed): stop instead of asking again forever.
        if (err instanceof ReviewEndedError) {
          print("");
          for (const l of reviewEndedLines("the job is waiting for its metrics")) print(l);
          return { code: 1, jobId: id };
        }
        // A typo in an edit: say why and review again.
        print(`That edit did not parse: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
        continue;
      }
      try {
        await manager.confirm(id, yaml);
      } catch (err) {
        if (!(err instanceof ManagerError) || err.code !== "BAD_REQUEST") throw err;
        print(`Not accepted: ${err.message}`);
        print("Review again.");
        continue;
      }
      status = await manager.wait(id);
    }
    if (status.status !== "done") {
      print("");
      print(`The job stopped at ${status.error?.stage ?? status.stage ?? "?"}: ${status.error?.code}: ${status.error?.message}`);
      print("Completed stages are saved; fix the cause, then continue with:");
      print(`  aa jobs resume ${id}`);
      return { code: 1, jobId: id };
    }
    const report = await manager.report(id);
    const dest = join(input.out, "agentic-analytics");
    mkdirSync(dest, { recursive: true });
    const jobDir = join(manager.root, id);
    copyFileSync(join(jobDir, "report.json"), join(dest, "report.json"));
    copyFileSync(join(jobDir, "report.html"), join(dest, "report.html"));
    print("");
    for (const l of reportSummaryText(report).split("\n")) print(l);
    print("");
    print(`report: ${join(dest, "report.json")}`);
    print(`html:   ${join(dest, "report.html")}`);
    return { code: 0, jobId: id, reportPath: join(dest, "report.json"), htmlPath: join(dest, "report.html") };
  } finally {
    unsubscribe();
  }
}
