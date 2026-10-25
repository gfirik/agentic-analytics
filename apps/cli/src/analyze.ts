// `aa analyze <paths…>` (interfaces §2): a full job through the job manager, as the API and MCP run it, with a live
// stage view and, without --yes, an interactive review of the drafted metrics. The report lands in
// `<out>/agentic-analytics/`.
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { type JobManager, type JobOptions, ManagerError, rolesScreenLines } from "@agentic-analytics/core";
import type { InputFile } from "@agentic-analytics/ingest";
import { metricsYaml, parseMetricsYaml, type ReviewChoice, rolesYaml } from "@agentic-analytics/metrics";
import { reportSummaryText } from "@agentic-analytics/report";
import type { BusinessModelEntry, ConfirmView, MetricDef, RoleEntry } from "@agentic-analytics/schema";
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

/** What the combined review sends back: roles first (they may re-draft the metrics), then the metrics. */
interface RolePass {
  readonly roles: RoleEntry[];
  readonly business_model: BusinessModelEntry;
  /** True when a role or the business model differs from what was shown. */
  readonly changed: boolean;
}

/** The text of a role edit: a bare role name, or `role: <name>`. */
const roleOf = (text: string): string =>
  text
    .trim()
    .replace(/^role\s*:\s*/i, "")
    .trim();

/**
 * The roles half of the screen (semantics §5): roles are accepted together or one by one, each edited (to any role of
 * the vocabulary) or dropped (`none`), then the business model. What is posted is confirmed; a role the person edits to the same value
 * is just accepted.
 */
async function reviewRoles(view: ConfirmView, review: ReviewPrompt): Promise<RolePass> {
  const roles: RoleEntry[] = [];
  let changed = false;
  // One question first, because a wide table has dozens of roles: accept them all, go through them one by one, or (drop)
  // leave them unconfirmed as assumptions.
  const group = view.roles.length
    ? await review.choose("Column roles: accept all, edit one by one, or drop (leave them unconfirmed, as assumptions)?")
    : "accept";
  if (group === "drop") view = { ...view, roles: [] };
  for (const r of view.roles) {
    const choice = group === "edit" ? await review.choose(`Role ${r.table}.${r.label}?`) : "accept";
    let role = r.role;
    if (choice === "drop") role = "none";
    if (choice === "edit") role = roleOf(await review.edit(`role: ${r.role}\n`)) || r.role;
    if (role !== r.role) changed = true;
    roles.push({ table: r.table, column: r.column, role });
  }
  const b = view.business_model;
  const choice = await review.choose(`Business model ${b.model}?`);
  let model = b.model;
  if (choice === "drop") model = "unknown";
  if (choice === "edit") model = roleOf((await review.edit(`model: ${b.model}\n`)).replace(/^model\s*:/i, "role:")) || b.model;
  if (model !== b.model) changed = true;
  return { roles, business_model: { model }, changed };
}

/** One pass over the drafted metrics: accept, edit or drop each; returns the YAML to confirm, roles included. */
async function reviewMetricsPass(yaml: string, review: ReviewPrompt, texts: readonly string[], pass: RolePass): Promise<string> {
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
  return metricsYaml(kept, { grain, roles: pass.roles, business_model: pass.business_model });
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
      let view = await manager.metrics(id);
      print("");
      print("Review the column roles and the drafted metric definitions. Every number in the report is computed from them.");
      print("");
      for (const l of rolesScreenLines(view)) print(l);
      let yaml: string;
      try {
        // Roles first: a changed role changes which metrics code drafts, so they are re-drafted before the metrics are shown.
        const pass = await reviewRoles(view, deps.review);
        if (pass.changed) {
          const revised = await manager.confirm(
            id,
            rolesYaml(pass.roles, { grain: parseMetricsYaml(view.yaml).grain, business_model: pass.business_model }),
          );
          if (revised.status !== "awaiting_confirmation") throw new Error("the job did not keep waiting after the role edits");
          view = await manager.metrics(id);
          print("");
          print("Metrics drafted again from your role changes:");
        }
        print("");
        print("Metrics:");
        yaml = await reviewMetricsPass(
          view.yaml,
          deps.review,
          view.metrics.map((x) => x.text),
          pass,
        );
      } catch (err) {
        // The input ended (piped answers ran out, or stdin is closed): stop instead of asking again forever.
        if (err instanceof ReviewEndedError) {
          print("");
          for (const l of reviewEndedLines("the job is waiting for its roles and metrics")) print(l);
          return { code: 1, jobId: id };
        }
        // A role the engine refuses (not in the vocabulary, no such column): say why and review again.
        if (err instanceof ManagerError && err.code !== "NOT_FOUND" && err.code !== "BUSY" && err.code !== "NOT_READY") {
          print(`Not accepted: ${err.message}`);
          print("Review again.");
          continue;
        }
        // A typo in an edit: say why and review again.
        print(`That edit did not parse: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
        continue;
      }
      try {
        await manager.confirm(id, yaml);
      } catch (err) {
        if (!(err instanceof ManagerError) || err.code === "NOT_FOUND" || err.code === "BUSY" || err.code === "NOT_READY") throw err;
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
