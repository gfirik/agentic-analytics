// The eval runner (docs/EVALS.md §3): runs every dataset of a suite as a full job with the given model, scores each
// report against its answer key, and writes `evals/results/<date>-<model>.json` plus the markdown table that
// RESULTS.md collects. Jobs run one at a time in temporary folders that are removed afterwards.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAFTED_METRICS, type JobOptions, runJob } from "@agentic-analytics/core";
import { type Dataset, generatedDatasets } from "@agentic-analytics/eval-generator";
import { type CallRecord, failedCall, type ModelClient, routeOf, spendOf } from "@agentic-analytics/models";
import type { Embedder } from "@agentic-analytics/retrieval";
import type { Report } from "@agentic-analytics/schema";
import { EvalRunError } from "./errors.ts";
import { type Bar, type DatasetScore, type RouteUse, scoreReport, summarize } from "./score.ts";

export type Suite = "smoke" | "full";

/** Smoke: three datasets across archetypes and every variant (EVALS §3). Full: all 30. */
export function suiteDatasets(suite: Suite, all: readonly Dataset[] = generatedDatasets()): Dataset[] {
  if (suite === "full") return [...all];
  const pick = ["coffee_roaster-v1", "saas-v2", "restaurant-v3"];
  return all.filter((d) => pick.includes(d.id));
}

export type { RouteUse } from "./score.ts";

export function routeSummary(calls: readonly CallRecord[]): RouteUse[] {
  const m = new Map<
    string,
    {
      role: string;
      route: string;
      calls: number;
      cached: number;
      failed: number;
      inputTokens: number;
      outputTokens: number;
      unknownTokens: number;
    }
  >();
  for (const c of calls) {
    const route = routeOf(c);
    const k = `${c.role ?? "?"} ${route}`;
    const u = m.get(k) ?? { role: c.role ?? "?", route, calls: 0, cached: 0, failed: 0, inputTokens: 0, outputTokens: 0, unknownTokens: 0 };
    u.calls++;
    if (c.cached) u.cached++;
    if (failedCall(c)) u.failed++;
    const spent = spendOf(c);
    if (spent) {
      u.inputTokens += spent.input;
      u.outputTokens += spent.output;
    } else u.unknownTokens++;
    m.set(k, u);
  }
  return [...m.values()].sort((a, b) => a.role.localeCompare(b.role) || a.route.localeCompare(b.route));
}

/** A run's provider usage (M14a): tokens as the providers counted them, cached calls at 0. */
export interface RunUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly calls: number;
  readonly cached: number;
  /** Live calls with no token count: their spend is not in the token sums. */
  readonly unknownTokens: number;
}

/** The run's usage from its routes, or undefined when a route has no token count (a result from before M14a). */
export function runUsage(routes: readonly RouteUse[]): RunUsage | undefined {
  let inputTokens = 0;
  let outputTokens = 0;
  let calls = 0;
  let cached = 0;
  let unknownTokens = 0;
  for (const u of routes) {
    if (u.inputTokens === undefined || u.outputTokens === undefined) return undefined;
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    calls += u.calls;
    cached += u.cached;
    unknownTokens += u.unknownTokens ?? 0;
  }
  return { inputTokens, outputTokens, calls, cached, unknownTokens };
}

/** The result's routes with their usage beside them, when every route has a token count. */
const withUsage = (routes: RouteUse[]): { routes: RouteUse[]; usage?: RunUsage } => {
  const usage = runUsage(routes);
  return { routes, ...(usage ? { usage } : {}) };
};

export interface SuiteResult {
  readonly suite: Suite;
  readonly model: string;
  readonly note?: string;
  readonly date: string;
  readonly datasets: number;
  readonly scores: DatasetScore[];
  readonly bars: Bar[];
  readonly seconds: number;
  readonly tokens: { readonly input: number; readonly output: number };
  /** Every route that served a call in this run, summed over datasets. */
  readonly routes?: RouteUse[];
  /**
   * Totals of the routes (M14a): tokens in and out from the providers' usage, calls and cached calls. Absent in
   * results written before M14a, and when a merged pass has routes without token counts; RESULTS.md shows "n/a".
   * `tokens` above is the model client's own sum, which counts a cached answer's original usage.
   */
  readonly usage?: RunUsage;
  /** A run carried over several passes (`aa eval --passes`, scripts/eval-daily.sh): absent for a one-pass run. */
  readonly passes?: Passes;
}

/**
 * The passes a run is carried over (docs/EVALS.md §4): the date of each pass so far, and how many it may take. A job
 * a pass didn't finish (a free tier's daily quota) is run again by the next pass; finished jobs are kept as scored.
 */
export interface Passes {
  readonly dates: readonly string[];
  readonly of: number;
}

/**
 * complete: every job finished. resuming: some didn't, and a later pass will run them. partial: some didn't and no
 * pass is left, so they are truly missing. Only a partial run is labelled partial (EVALS §4).
 */
export type RunStatus = "complete" | "resuming" | "partial";

export function runStatus(done: number, total: number, passes?: Passes): RunStatus {
  if (done >= total) return "complete";
  return passes && passes.dates.length < passes.of ? "resuming" : "partial";
}

const statusOf = (r: Pick<SuiteResult, "scores" | "passes">): RunStatus =>
  runStatus(r.scores.filter((s) => s.completed).length, r.scores.length, r.passes);

/** What the next pass of a run does: the earlier pass to carry on, if any, and the datasets to run. */
export interface ResumePlan {
  /** The earlier result whose finished jobs are kept; absent: a fresh run. */
  readonly from?: SuiteResult;
  /**
   * The earlier result, closed, when it was still waiting for a pass that will now never come (a skipped night, a
   * model change): written back over its file so it reads partial instead of "in progress" for ever.
   */
  readonly close?: SuiteResult;
  /** Why a fresh run did not carry on the earlier result, for the log. */
  readonly reason?: string;
  readonly run: readonly string[];
  readonly passes: Passes;
}

/**
 * Plans tonight's pass from the latest result of the same row. It carries that result on only when it is still
 * resuming (unfinished jobs and a pass left), names the same model and suite, was served by the same model per role
 * (`roleModels`, canonical ids, checked before any quota is spent), covers exactly the suite's datasets, and its last
 * pass was the day before `today`: passes are nightly, an older result was scored by older code, and a same-day
 * rerun starts again rather than using up the second pass. Otherwise the run starts again with every dataset (its
 * finished calls still come from the response cache), and an earlier result that was still resuming is closed.
 * Throws USAGE when a multi-pass run already had its pass today: starting again would overwrite it.
 */
export function planResume(
  prev: SuiteResult | undefined,
  o: {
    readonly suite: Suite;
    readonly modelName: string;
    readonly ids: readonly string[];
    readonly passes: number;
    readonly today: string;
    readonly roleModels?: Readonly<Record<string, string>>;
  },
): ResumePlan {
  const fresh: ResumePlan = { run: o.ids, passes: { dates: [o.today], of: o.passes } };
  if (!prev) return fresh;
  const passes = prev.passes ?? { dates: [prev.date], of: 1 };
  // Waiting for a pass by its own count: if it isn't carried on tonight it never will be.
  const waiting = statusOf(prev) === "resuming";
  const closed = { ...prev, passes: { dates: passes.dates, of: passes.dates.length } };
  const startAgain = (reason: string): ResumePlan =>
    waiting && passes.dates.at(-1) !== o.today ? { ...fresh, close: closed, reason } : { ...fresh, reason };
  // A run carried over several passes already ran its last one today: a fresh run would overwrite the combined file
  // (same date, same name) and drop the earlier nights' scores, on a quota that is spent.
  if (prev.passes && passes.dates.length > 1 && passes.dates.at(-1) === o.today)
    throw new EvalRunError(
      "USAGE",
      `the run over ${passes.dates.join(", ")} already had its pass today and is ${statusOf(prev) === "complete" ? "complete" : "closed"}; rerun tomorrow (a new run) or move its results file aside first`,
    );
  // A result with passes is judged by its own count, so a closed one (of = its passes) is never reopened; a file
  // written before --passes counts as the first of tonight's.
  const resumable = prev.passes
    ? waiting
    : runStatus(prev.scores.filter((s) => s.completed).length, prev.scores.length, { dates: passes.dates, of: o.passes }) === "resuming";
  if (!resumable) return prev.scores.every((s) => s.completed) ? fresh : startAgain(`the ${prev.date} result has no pass left`);
  if (prev.suite !== o.suite || prev.model !== o.modelName) return startAgain(`the ${prev.date} result names another model or suite`);
  const changed = (prev.routes ?? []).filter((u) => o.roleModels?.[u.role] !== undefined && routeModel(u.route) !== o.roleModels[u.role]);
  if (changed.length) return startAgain(`the ${prev.date} result's ${changed.map((u) => u.role).join(", ")} was served by another model`);
  const last = passes.dates.at(-1) ?? prev.date;
  const days = (Date.parse(o.today) - Date.parse(last)) / 86_400_000;
  if (days === 0) return { ...fresh, reason: `the ${prev.date} pass ran today: a same-day rerun starts again` };
  if (days !== 1) return startAgain(`the ${prev.date} pass is not last night's`);
  const ids = prev.scores.map((s) => s.dataset);
  if (ids.length !== o.ids.length || o.ids.some((id) => !ids.includes(id)))
    return startAgain(`the ${prev.date} result covers other datasets`);
  return {
    from: prev,
    run: o.ids.filter((id) => !prev.scores.find((s) => s.dataset === id)?.completed),
    passes: { dates: [...passes.dates, o.today], of: o.passes },
  };
}

/**
 * One result from an earlier pass and tonight's: the earlier finished jobs as they were scored, tonight's jobs for
 * the rest (a job that failed before and finished tonight counts as finished). The bars are computed again.
 */
export function resumeResult(from: SuiteResult, tonight: SuiteResult, passes: Passes, order: readonly string[]): SuiteResult {
  const kept = from.scores.filter((s) => s.completed && !tonight.scores.some((t) => t.dataset === s.dataset));
  const note = tonight.note ?? from.note;
  const merged = mergeResults(
    [{ ...from, scores: kept, routes: mergeRoutes(kept.flatMap((s) => s.routes ?? [])) }, tonight].filter((p) => p.scores.length),
    { suite: tonight.suite, modelName: tonight.model, ...(note ? { note } : {}), order },
  );
  return { ...merged, date: tonight.date, passes };
}

/** Counts tokens across every call of a model client. */
function counting(model: ModelClient): { model: ModelClient; tokens: { input: number; output: number } } {
  const tokens = { input: 0, output: 0 };
  return {
    tokens,
    model: {
      async generateObject(a) {
        const r = await model.generateObject(a);
        tokens.input += r.usage.inputTokens;
        tokens.output += r.usage.outputTokens;
        return r;
      },
      async generateWithTools(a) {
        const r = await model.generateWithTools(a);
        tokens.input += r.usage.inputTokens;
        tokens.output += r.usage.outputTokens;
        return r;
      },
      embed: (t) => model.embed(t),
    },
  };
}

export interface RunOptions {
  readonly suite: Suite;
  /**
   * A fresh model client per dataset (scripted models keep state). It reports every call to `onCall`, so the
   * results record which provider and model served the run (M13a).
   */
  /** A model client per dataset (the dataset id lets a scripted model answer per dataset, e.g. replayed drafts). */
  readonly model: (onCall: (c: CallRecord) => void, dataset: string) => ModelClient;
  readonly modelName: string;
  readonly note?: string;
  readonly embedder: Embedder;
  readonly smallModel?: boolean;
  readonly datasets?: readonly Dataset[];
  readonly onDataset?: (s: DatasetScore, i: number, n: number) => void;
  /** Keep each report as `<dir>/<dataset>.json` (real-model runs cost tokens; this lets them be inspected later). */
  readonly keepReports?: string;
  readonly now?: () => Date;
  /** Each dataset's report as the job shipped it (undefined when the job failed): `aa eval --repeat` compares them. */
  readonly onReport?: (dataset: string, report: Report | undefined) => void;
}

/**
 * Copies a job's drafted metrics (metrics.drafted.json) next to its kept report as `<dataset>.metrics.drafted.json`,
 * whether the job finished or failed: the job folder is temporary, and a real model's draft can't be re-created.
 */
export function keepDraftedMetrics(jobDir: string, keepDir: string, dataset: string): void {
  const src = join(jobDir, DRAFTED_METRICS);
  if (!existsSync(src)) return;
  mkdirSync(keepDir, { recursive: true });
  copyFileSync(src, join(keepDir, `${dataset}.metrics.drafted.json`));
}

export async function runSuite(o: RunOptions): Promise<SuiteResult> {
  const datasets = o.datasets ?? suiteDatasets(o.suite);
  const scores: DatasetScore[] = [];
  const t0 = Date.now();
  for (const [i, ds] of datasets.entries()) {
    const dir = mkdtempSync(join(tmpdir(), `aa-eval-${ds.id}-`));
    const calls: CallRecord[] = [];
    const { model, tokens } = counting(o.model((c) => calls.push(c), ds.id));
    const started = Date.now();
    const options: JobOptions = {
      today: ds.answers.today,
      currency: ds.answers.currency,
      ...(o.smallModel ? { smallModel: true } : {}),
    };
    let score: DatasetScore;
    let report: Report | undefined;
    try {
      const out = await runJob(
        { dir, jobId: ds.id, files: Object.entries(ds.files).map(([name, bytes]) => ({ name, bytes })), options },
        { model, embedder: o.embedder },
      );
      score = scoreReport(out.report, ds.answers, { seconds: (Date.now() - started) / 1000, tokens });
      if (o.keepReports) {
        mkdirSync(o.keepReports, { recursive: true });
        writeFileSync(join(o.keepReports, `${ds.id}.json`), `${JSON.stringify(out.report, null, 2)}\n`);
      }
      // Only now: a job whose scoring or keep-reports write failed is scored failed, so its report isn't handed on.
      report = out.report;
    } catch (err) {
      // A stage failure wraps the stage's own error; the verifier's mismatch codes are what count here.
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
      const code = cause instanceof Error && "code" in cause && typeof cause.code === "string" ? cause.code : undefined;
      score = scoreReport(undefined, ds.answers, {
        seconds: (Date.now() - started) / 1000,
        tokens,
        error: { ...(code ? { code } : {}), message: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      if (o.keepReports) keepDraftedMetrics(dir, o.keepReports, ds.id);
      rmSync(dir, { recursive: true, force: true });
    }
    scores.push({ ...score, routes: routeSummary(calls) });
    o.onReport?.(ds.id, report);
    o.onDataset?.(score, i, datasets.length);
  }
  return {
    suite: o.suite,
    model: o.modelName,
    ...(o.note ? { note: o.note } : {}),
    date: (o.now ?? (() => new Date()))().toISOString().slice(0, 10),
    datasets: datasets.length,
    scores,
    bars: summarize(scores),
    ...withUsage(mergeRoutes(scores.flatMap((s) => s.routes ?? []))),
    seconds: (Date.now() - t0) / 1000,
    tokens: {
      input: scores.reduce((a, s) => a + s.tokens.input, 0),
      output: scores.reduce((a, s) => a + s.tokens.output, 0),
    },
  };
}

/**
 * The model a route (`provider[:endpoint]:model`, as routeSummary writes it) served, as the router compares models:
 * the id after the last "/", lower-cased (models' canonicalModel).
 */
function routeModel(route: string): string {
  const [provider, ...rest] = route.split(":");
  // An openai-compatible route always names its endpoint (the config refuses one without, models §4), so the model
  // starts after it; a route written without one keeps everything after the provider rather than losing a segment.
  const model = (provider === "openai-compatible" && rest.length > 1 ? rest.slice(1) : rest).join(":");
  return (model.split("/").pop() ?? model).toLowerCase().replace(/:(free|latest)$/, "");
}

/**
 * One suite result from runs of parts of it (`aa eval --only`, e.g. the Kaggle notebook's one-business-per-run
 * chunks that fit a session limit). Scores are taken as each run recorded them, so timings and tokens are the real
 * ones; the bars are computed again over all of them. Every dataset of the suite must be there exactly once, all
 * runs must name the same model, and the result has the same shape as a single run's.
 */
export function mergeResults(
  parts: readonly SuiteResult[],
  o: { readonly suite: Suite; readonly modelName: string; readonly note?: string; readonly order: readonly string[] },
): SuiteResult {
  const models = new Set(parts.map((p) => p.model));
  if (models.size > 1) throw new EvalRunError("USAGE", `the runs name different models: ${[...models].join(", ")}`);
  const suites = new Set(parts.map((p) => p.suite));
  if ([...suites].some((s) => s !== o.suite))
    throw new EvalRunError("USAGE", `the runs are not all ${o.suite} runs: ${[...suites].join(", ")}`);
  // "configured" names no model: the routes say what served each run. Per role, every run must have been served by
  // the same model; a route may differ only as a fallback provider of that model (the router never switches models).
  // A run that never called a role (a job that failed early) says nothing about it.
  const served = new Map<string, Set<string>>();
  for (const p of parts)
    for (const u of p.routes ?? []) {
      const set = served.get(u.role) ?? new Set<string>();
      set.add(routeModel(u.route));
      served.set(u.role, set);
    }
  for (const [role, models] of served)
    if (models.size > 1) throw new EvalRunError("USAGE", `the runs' ${role} was served by different models: ${[...models].join(", ")}`);
  const byId = new Map<string, DatasetScore>();
  for (const p of parts)
    for (const s of p.scores) {
      if (byId.has(s.dataset)) throw new EvalRunError("USAGE", `${s.dataset} is in more than one run`);
      byId.set(s.dataset, s);
    }
  const missing = o.order.filter((id) => !byId.has(id));
  if (missing.length) throw new EvalRunError("USAGE", `missing from the runs: ${missing.join(", ")}`);
  const extra = [...byId.keys()].filter((id) => !o.order.includes(id));
  if (extra.length) throw new EvalRunError("UNKNOWN_DATASET", `not in the ${o.suite} suite: ${extra.join(", ")}`);
  const scores = o.order.map((id) => byId.get(id) as DatasetScore);
  return {
    suite: o.suite,
    model: o.modelName,
    ...(o.note ? { note: o.note } : {}),
    date:
      parts
        .map((p) => p.date)
        .sort()
        .at(-1) ?? "",
    datasets: scores.length,
    scores,
    bars: summarize(scores),
    ...withUsage(mergeRoutes(scores.flatMap((s) => s.routes ?? []))),
    seconds: scores.reduce((a, s) => a + s.seconds, 0),
    tokens: {
      input: scores.reduce((a, s) => a + s.tokens.input, 0),
      output: scores.reduce((a, s) => a + s.tokens.output, 0),
    },
  };
}

/** Sums route uses over datasets. Tokens are summed only when both sides have them (unknown stays unknown). */
export function mergeRoutes(uses: readonly RouteUse[]): RouteUse[] {
  const m = new Map<string, RouteUse>();
  const both = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? undefined : a + b);
  for (const u of uses) {
    const k = `${u.role} ${u.route}`;
    const prev = m.get(k);
    if (!prev) {
      m.set(k, u);
      continue;
    }
    const { inputTokens: _i, outputTokens: _o, unknownTokens: _u, ...rest } = prev;
    const inputTokens = both(prev.inputTokens, u.inputTokens);
    const outputTokens = both(prev.outputTokens, u.outputTokens);
    const unknownTokens = both(prev.unknownTokens, u.unknownTokens);
    m.set(k, {
      ...rest,
      calls: prev.calls + u.calls,
      cached: prev.cached + u.cached,
      failed: prev.failed + u.failed,
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(unknownTokens !== undefined ? { unknownTokens } : {}),
    });
  }
  return [...m.values()].sort((a, b) => a.role.localeCompare(b.role) || a.route.localeCompare(b.route));
}
const pct = (v: number | undefined) => (v === undefined ? "n/a" : `${(v * 100).toFixed(1)}%`);

const passCell = (b: Bar, status: RunStatus) =>
  status !== "complete" && b.metric !== "Jobs completed"
    ? status === "resuming"
      ? "n/a (resumes next pass)"
      : "n/a (partial run)"
    : b.pass === undefined
      ? "n/a"
      : b.pass
        ? "yes"
        : "**no**";

/** The passes line of a carried-over run: which nights it combines, and what its unfinished jobs mean. */
const passesLine = (r: SuiteResult, status: RunStatus) => {
  if (!r.passes) return [];
  const n = r.passes.dates.length;
  const what =
    status === "resuming"
      ? "unfinished jobs run again on the next pass"
      : status === "partial"
        ? "partial: jobs still unfinished after the last pass"
        : "every job finished";
  return [`Passes: ${r.passes.dates.join(", ")} (${n} of up to ${r.passes.of}; ${what}).`, ""];
};

const count = (v: number) => v.toLocaleString("en-US");

/** The run's provider usage (M14a), or "n/a" for a result written before it was recorded. */
export const usageLine = (u: RunUsage | undefined) =>
  !u
    ? "Usage: n/a (tokens per call not recorded for this run)"
    : u.calls === 0
      ? // The scripted baseline answers in-process: usage counts provider calls only.
        "Usage: no provider calls (scripted model)"
      : `Usage: ${count(u.inputTokens)} tokens in, ${count(u.outputTokens)} out · ${count(u.calls)} calls (${[
          `${count(u.cached)} cached at 0 tokens`,
          ...(u.unknownTokens ? [`${count(u.unknownTokens)} without a token count`] : []),
        ].join(", ")})`;

/** One model's results as markdown: the bars, then one line per dataset. */
export function resultsMarkdown(r: SuiteResult): string {
  // With unfinished jobs every rate counts them as misses, or covers only the finished few: no bar is judged.
  const status = statusOf(r);
  const lines = [
    `### ${r.model} · ${r.suite} suite · ${r.date}`,
    "",
    ...(r.note ? [r.note, ""] : []),
    ...passesLine(r, status),
    `${r.datasets} datasets · ${r.seconds.toFixed(0)} s · ${r.tokens.input + r.tokens.output} tokens`,
    "",
    usageLine(r.usage),
    "",
    ...(r.routes?.length
      ? [
          `Served by: ${r.routes.map((u) => `${u.role} → ${u.route} (${u.calls} calls, ${u.cached} cached${u.failed ? `, ${u.failed} failed` : ""})`).join("; ")}`,
          "",
        ]
      : []),
    "| Metric | Result | v0.1 bar | Pass |",
    "|---|---|---|---|",
    ...r.bars.map(
      (b) => `| ${b.metric} | ${b.metric === "Number mismatches" ? String(b.value) : pct(b.value)} | ${b.bar} | ${passCell(b, status)} |`,
    ),
    "",
    "<details><summary>Per dataset</summary>",
    "",
    "| Dataset | Done | Planted found | Distractors reported | Quality found | Findings | Time |",
    "|---|---|---|---|---|---|---|",
    ...r.scores.map(
      (s) =>
        `| ${s.dataset} | ${s.completed ? "yes" : `no (${(s.error ?? "").slice(0, 60)})`} | ${s.planted.filter((p) => p.detected).length}/${s.planted.length} | ${s.distractorsReported.join(", ") || "none"} | ${s.qualityFound.length}/${s.quality} | ${s.findings} | ${s.seconds.toFixed(1)} s |`,
    ),
    "",
    "</details>",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Scores a published run again from its kept reports (`--keep-reports`), e.g. after a scoring fix, without calling
 * the model again. Datasets without a kept report keep their original score; timings and tokens are unchanged.
 */
export function rescore(r: SuiteResult, reports: ReadonlyMap<string, Report>, keys: readonly Dataset[] = generatedDatasets()): SuiteResult {
  const scores = r.scores.map((s) => {
    const report = reports.get(s.dataset);
    const key = keys.find((d) => d.id === s.dataset)?.answers;
    // The routes (provider, model, tokens per call) come from the run, not the report: keep them.
    return report && key && s.completed
      ? { ...scoreReport(report, key, { seconds: s.seconds, tokens: s.tokens }), ...(s.routes ? { routes: s.routes } : {}) }
      : s;
  });
  return { ...r, scores, bars: summarize(scores) };
}
