// `aa eval --suite smoke|full --model baseline|configured|<provider:model>` (docs/EVALS.md §3): runs the suite,
// writes `evals/results/<date>-<model>-<suite>.json` and regenerates `evals/RESULTS.md` from every results file.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Dataset } from "@agentic-analytics/eval-generator";
import { type CallRecord, canonicalModel, describeRoleModel, type ModelClient } from "@agentic-analytics/models";
import type { Embedder } from "@agentic-analytics/retrieval";
import { baselineModel } from "./baseline.ts";
import { EvalRunError } from "./errors.ts";
import { missingRealData, type RealSuiteResult, realResultsMarkdown, runRealSuite } from "./real.ts";
import {
  mergeResults,
  planResume,
  resultsMarkdown,
  resumeResult,
  runStatus,
  runSuite,
  type Suite,
  type SuiteResult,
  suiteDatasets,
} from "./run.ts";

export { EvalRunError };

export interface EvalArgs {
  readonly suite: Suite;
  /** "baseline" (the scripted heuristic, no LLM) or a model name used for every role. */
  readonly model: string;
  readonly smallModel?: boolean;
  /** Where results files go (default evals/results). */
  readonly resultsDir: string;
  /** Where the RESULTS.md page is written (default: beside the results folder, i.e. evals/RESULTS.md in a checkout). */
  readonly resultsPage?: string;
  /** Keep each dataset's report.json in this folder. */
  readonly keepReports?: string;
  /**
   * With the baseline model only: a folder of kept drafts (`<dataset>.metrics.drafted.json`, from --keep-reports) whose
   * proposals answer each dataset's metric-draft request, so a run measures ranking under a real model's metrics.
   */
  readonly replayDrafts?: string;
  /**
   * The model as RESULTS.md and the README name it, e.g. "vllm (Kaggle 2×T4) Qwen3.8-27B-AWQ": its own row, apart
   * from other runs of `configured`. It also names the results file (evalSlug). Default: the --model value.
   */
  readonly label?: string;
  /** A note shown above the run's table in RESULTS.md (hardware, mode, caveats). */
  readonly note?: string;
  /** Run only these datasets of the suite (ids like saas-v2): one chunk of a long run, filling the response cache. */
  readonly only?: readonly string[];
  /**
   * The row name when no label is given, e.g. the configured routes for `--model configured`. Unlike a label it
   * leaves the results file name alone (`<date>-configured-<suite>.json`). Default: the --model value.
   */
  readonly name?: string;
  /**
   * Carry the run over up to this many passes (scripts/eval-daily.sh: 2 nights). A pass resumes the latest result of
   * the same row while it has unfinished jobs and a pass left: it runs only those jobs and writes the combined result,
   * replacing the earlier file. Absent or 1: every run starts afresh.
   */
  readonly passes?: number;
  /**
   * The model id each role is configured with (canonical: after the last "/", lower-cased), e.g. `{ planner:
   * "qwen3.8-27b" }`. With --passes, an earlier result served by another model is not carried on: checked before
   * the pass spends any quota.
   */
  readonly roleModels?: Readonly<Record<string, string>>;
}

/**
 * Reads an earlier results file for --passes. A file that doesn't parse or isn't a suite result is not carried on:
 * the pass starts again (and says why) rather than losing the night.
 */
export function readPrevious(path: string): SuiteResult | EvalRunError {
  try {
    const r = JSON.parse(readFileSync(path, "utf8")) as Partial<SuiteResult> | null;
    const ok =
      r !== null &&
      typeof r === "object" &&
      (r.suite === "smoke" || r.suite === "full") &&
      typeof r.model === "string" &&
      typeof r.date === "string" &&
      Array.isArray(r.scores) &&
      r.scores.every((x) => typeof x?.dataset === "string" && typeof x.completed === "boolean") &&
      (r.passes === undefined || (Array.isArray(r.passes.dates) && typeof r.passes.of === "number"));
    return ok ? (r as SuiteResult) : new EvalRunError("BAD_RESULTS", `${path} is not a suite result; starting a new run`);
  } catch (err) {
    return new EvalRunError(
      "BAD_RESULTS",
      `${path} could not be read (${err instanceof Error ? err.message : String(err)}); starting a new run`,
    );
  }
}

export interface EvalDeps {
  /** Builds a real model client for a model name; absent means only the baseline can run. */
  readonly modelFor?: (name: string, onCall?: (c: CallRecord) => void) => ModelClient;
  readonly embedder: Embedder;
  readonly print: (line: string) => void;
  readonly now?: () => Date;
}

const BASELINE_NOTE =
  'Baseline: a scripted heuristic (keyword extractor, rule-based planner and word-overlap judge), not a language model. Its rules were written knowing the generator\'s document templates (e.g. it treats a sentence with "after" and "pausing" as a stated cause), so its cause-grade and action scores are optimistic. It checks the harness end to end; it is not evidence of model quality.';

/**
 * The results file name, without `.json`: `<date>-<model>[-small]-<suite>`. A label is lower-cased with every run of
 * other characters turned into "-" ("vllm (Kaggle 2×T4) Qwen3.8-27B-AWQ" → "vllm-kaggle-2-t4-qwen3.8-27b-awq"); a
 * model name keeps its old spelling, so earlier results files keep their names.
 */
export function evalSlug(date: string, a: Pick<EvalArgs, "model" | "label" | "smallModel" | "suite">): string {
  const name = a.label
    ? a.label
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, "-")
        .replace(/^-+|-+$/g, "")
    : a.model.replace(/[^\w.-]+/g, "_");
  return `${date}-${name}${a.smallModel ? "-small" : ""}-${a.suite}`;
}

type Route = { readonly provider: string; readonly endpoint?: string | undefined; readonly model: string };

/**
 * The row name of `--model configured` with no label: what serves it, so a nightly run is published under its models
 * rather than as "configured". The planner's route in full, then the extractor and judge, by model id alone when they
 * share the planner's provider and endpoint, e.g. "openai-compatible:groq:qwen/qwen3.8-27b planner, gpt-oss-120b
 * extractor, gpt-oss-20b judge". Fallback routes serve the same model and are listed under "Served by".
 */
export function configuredName(m: { readonly planner: Route; readonly extractor: Route; readonly judge: Route }): string {
  const same = (r: Route) => r.provider === m.planner.provider && r.endpoint === m.planner.endpoint;
  const other = (r: Route) => (same(r) ? canonicalModel(r.model) : describeRoleModel(r));
  return `${describeRoleModel(m.planner)} planner, ${other(m.extractor)} extractor, ${other(m.judge)} judge`;
}

/** The suite's datasets, or the ones `only` names; an id outside the suite is an error, never silently skipped. */
export function selectDatasets(suite: Suite, only?: readonly string[], from?: readonly Dataset[]): Dataset[] {
  const all = from ? suiteDatasets(suite, from) : suiteDatasets(suite);
  if (!only?.length) return all;
  const unknown = only.filter((id) => !all.some((d) => d.id === id));
  if (unknown.length)
    throw new EvalRunError(
      "UNKNOWN_DATASET",
      `not in the ${suite} suite: ${unknown.join(", ")} (ids look like coffee_roaster-v1; the ${suite} suite has ${all.length})`,
    );
  return all.filter((d) => only.includes(d.id));
}

/**
 * `bun run eval:merge`: checks the arguments against the chunks, then mergeResults. The suite must be smoke or full,
 * and every chunk must have run in the mode `smallModel` says (its model name carries the small-model suffix).
 */
export function mergeChunks(
  a: { readonly label: string; readonly note?: string; readonly smallModel?: boolean; readonly suite: string },
  parts: readonly SuiteResult[],
  order?: readonly string[],
): SuiteResult {
  if (a.suite !== "smoke" && a.suite !== "full") throw new EvalRunError("USAGE", `--suite must be smoke or full, not "${a.suite}"`);
  const small = a.smallModel === true;
  const mismatched = parts.filter((p) => p.model.endsWith(" (small-model mode)") !== small);
  if (mismatched.length)
    throw new EvalRunError(
      "USAGE",
      `${small ? "--small-model is set but" : "--small-model is not set but"} these runs ${small ? "were not" : "were"} in small-model mode: ${mismatched.map((p) => p.model).join(", ")}`,
    );
  return mergeResults(parts, {
    suite: a.suite,
    modelName: a.label + (small ? " (small-model mode)" : ""),
    ...(a.note ? { note: a.note } : {}),
    order: order ?? suiteDatasets(a.suite).map((d) => d.id),
  });
}

/**
 * A dataset's kept drafts: the proposals in `<dir>/<dataset>.metrics.drafted.json`. None when the file is absent or the
 * draft wasn't the model's (the job fell back to the scripted draft); a file that isn't JSON is `BAD_RESULTS`.
 */
export function replayedDrafts(dir: string, dataset: string): readonly unknown[] | undefined {
  const file = join(dir, `${dataset}.metrics.drafted.json`);
  if (!existsSync(file)) return undefined;
  try {
    const kept = JSON.parse(readFileSync(file, "utf8")) as { source?: string; proposals?: unknown };
    return kept.source === "model" && Array.isArray(kept.proposals) ? kept.proposals : undefined;
  } catch (cause) {
    throw new EvalRunError("BAD_RESULTS", `${file} is not a kept metrics draft`, { cause });
  }
}

export async function evalCommand(a: EvalArgs, d: EvalDeps): Promise<SuiteResult> {
  const baseline = a.model === "baseline";
  if (!baseline && !d.modelFor) throw new EvalRunError("NO_MODEL", `no model client for ${a.model}`);
  const all = selectDatasets(a.suite, a.only);
  const modelName = (a.label ?? a.name ?? a.model) + (a.smallModel ? " (small-model mode)" : "");
  // One clock reading for the pass: its date in `passes` and the result's date are the same day, even past midnight.
  const at = (d.now ?? (() => new Date()))();
  const today = at.toISOString().slice(0, 10);
  const carried = (a.passes ?? 1) > 1;
  if (carried && a.only?.length) throw new EvalRunError("USAGE", "--passes goes with a whole suite, not --only");
  // The latest file of this row (`<date><suffix>.json`); a pass carries it on only while it is resuming (planResume).
  const suffix = evalSlug("", a);
  const prevFile = carried
    ? (existsSync(a.resultsDir) ? readdirSync(a.resultsDir) : [])
        .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.slice(0, 10)) && f.slice(10) === `${suffix}.json`)
        .sort()
        .at(-1)
    : undefined;
  const prev = prevFile ? readPrevious(join(a.resultsDir, prevFile)) : undefined;
  // Set aside as `<file>.bad`, not deleted: kept for a look, and no longer read as a results file by RESULTS.md.
  if (prev instanceof EvalRunError && prevFile) {
    renameSync(join(a.resultsDir, prevFile), join(a.resultsDir, `${prevFile}.bad`));
    d.print(`warning: ${prev.message} (moved to ${prevFile}.bad)`);
  }
  const plan = carried
    ? planResume(prev instanceof EvalRunError ? undefined : prev, {
        suite: a.suite,
        modelName,
        ids: all.map((x) => x.id),
        passes: a.passes as number,
        today,
        ...(a.roleModels ? { roleModels: a.roleModels } : {}),
      })
    : undefined;
  if (plan?.reason && prev) d.print(`starting a new run: ${plan.reason}`);
  // The earlier result waited for this pass and won't get it: closed, it reads partial rather than "in progress".
  if (plan?.close && prevFile) {
    writeFileSync(join(a.resultsDir, prevFile), `${JSON.stringify(plan.close, null, 2)}\n`);
    d.print(
      `closed ${prevFile}: ${plan.close.scores.filter((x) => x.completed).length} of ${plan.close.scores.length} jobs finished (partial)`,
    );
  }
  if (plan?.from)
    d.print(
      `resuming the ${plan.from.date} pass (${prevFile}): ${all.length - plan.run.length} of ${all.length} jobs finished, running the other ${plan.run.length}`,
    );
  const datasets = plan ? all.filter((x) => plan.run.includes(x.id)) : all;
  if (a.replayDrafts && !baseline) throw new EvalRunError("USAGE", "--replay-drafts goes with --model baseline");
  // Replayed drafts are read up front: a missing or mistyped folder must not quietly run the scripted drafts instead.
  const replayed = new Map<string, readonly unknown[]>();
  if (a.replayDrafts) {
    if (!existsSync(a.replayDrafts)) throw new EvalRunError("USAGE", `--replay-drafts: no folder ${a.replayDrafts}`);
    for (const x of datasets) {
      const proposals = replayedDrafts(a.replayDrafts, x.id);
      if (proposals) replayed.set(x.id, proposals);
    }
    if (!replayed.size) throw new EvalRunError("USAGE", `--replay-drafts: no model draft in ${a.replayDrafts} for these datasets`);
    d.print(`replaying model drafts for ${replayed.size} of ${datasets.length} datasets (the rest use the scripted draft)`);
  }
  const make = baseline
    ? (_onCall: (c: CallRecord) => void, id: string) => {
        const proposals = replayed.get(id);
        return baselineModel({ small: a.smallModel === true, ...(proposals ? { drafts: proposals } : {}) });
      }
    : (onCall: (c: CallRecord) => void) => (d.modelFor as NonNullable<EvalDeps["modelFor"]>)(a.model, onCall);
  const r = await runSuite({
    suite: a.suite,
    model: make,
    modelName,
    ...(a.note ? { note: a.note } : baseline ? { note: BASELINE_NOTE } : {}),
    datasets,
    embedder: d.embedder,
    ...(a.smallModel ? { smallModel: true } : {}),
    ...(a.keepReports ? { keepReports: a.keepReports } : {}),
    now: () => at,
    onDataset: (s, i, n) =>
      d.print(
        `[${i + 1}/${n}] ${s.dataset}: ${s.completed ? `${s.planted.filter((p) => p.detected).length}/${s.planted.length} planted found` : `failed (${s.error})`} · ${s.seconds.toFixed(1)} s`,
      ),
  });
  const tonight = r;
  const result = !plan
    ? tonight
    : plan.from
      ? resumeResult(
          plan.from,
          tonight,
          plan.passes,
          all.map((x) => x.id),
        )
      : { ...tonight, passes: plan.passes };
  mkdirSync(a.resultsDir, { recursive: true });
  const slug = evalSlug(result.date, a);
  writeFileSync(join(a.resultsDir, `${slug}.json`), `${JSON.stringify(result, null, 2)}\n`);
  // The combined result holds the earlier pass's finished jobs: its own file would be a second, stale row.
  if (plan?.from && prevFile && prevFile !== `${slug}.json`) rmSync(join(a.resultsDir, prevFile));
  writeFileSync(a.resultsPage ?? join(a.resultsDir, "..", "RESULTS.md"), resultsPage(a.resultsDir));
  d.print("");
  if (plan) {
    const done = result.scores.filter((s) => s.completed).length;
    const status = runStatus(done, result.scores.length, result.passes);
    d.print(
      `combined: ${done} of ${result.scores.length} jobs finished over ${plan.passes.dates.length} of up to ${plan.passes.of} passes (${plan.passes.dates.join(", ")}): ${status === "resuming" ? "the next pass runs the rest" : status}`,
    );
  }
  for (const b of result.bars)
    d.print(
      `${b.metric}: ${b.value === undefined ? "n/a" : b.metric === "Number mismatches" ? b.value : `${(b.value * 100).toFixed(1)}%`} (bar ${b.bar})`,
    );
  d.print(`results: ${join(a.resultsDir, `${slug}.json`)}`);
  return result;
}

export interface RealEvalArgs {
  /** "baseline" (the scripted heuristic, no LLM) or a model name used for every role. */
  readonly model: string;
  readonly resultsDir: string;
  /** evals/real/data (fetched files) and evals/real/answers. */
  readonly dataDir: string;
  readonly answersDir: string;
  /** Where the RESULTS.md page is written (default: beside the results folder). */
  readonly resultsPage?: string;
  readonly keepReports?: string;
}

const REAL_BASELINE_NOTE =
  "Baseline: the scripted heuristic, no language model. On real files it drafts metrics with the deterministic fallbacks (or uses the answer file's confirmed definitions) and finds changes with the analysis library; it writes no causes from documents (there are none). Each check reads report.json; its expected numbers come from the SQL in `evals/real/answers/`.";

/**
 * `aa eval --suite real`: the real-data tier. Needs `bun run eval:real:fetch` first; with any file missing it
 * stops (NO_DATA) instead of publishing a partial run. Writes `<date>-<model>-real.json` and RESULTS.md.
 */
export async function realEvalCommand(a: RealEvalArgs, d: EvalDeps): Promise<RealSuiteResult> {
  const baseline = a.model === "baseline";
  if (!baseline && !d.modelFor) throw new EvalRunError("NO_MODEL", `no model client for ${a.model}`);
  const missing = missingRealData(a.answersDir, a.dataDir);
  if (missing.length)
    throw new EvalRunError(
      "NO_DATA",
      `real-data files missing for ${missing.join(", ")} in ${a.dataDir}; for the public datasets run \`bun run eval:real:fetch\` first`,
    );
  const r = await runRealSuite({
    model: baseline ? () => baselineModel() : () => (d.modelFor as NonNullable<EvalDeps["modelFor"]>)(a.model),
    modelName: a.model,
    ...(baseline ? { note: REAL_BASELINE_NOTE } : {}),
    embedder: d.embedder,
    dataDir: a.dataDir,
    answersDir: a.answersDir,
    ...(a.keepReports ? { keepReports: a.keepReports } : {}),
    ...(d.now ? { now: d.now } : {}),
    onDataset: (s, i, n) =>
      d.print(
        `[${i + 1}/${n}] ${s.dataset}: ${s.completed ? `${s.checks.filter((c) => c.pass).length}/${s.checks.length} checks pass` : `failed (${s.error})`} · ${s.seconds.toFixed(1)} s`,
      ),
  });
  mkdirSync(a.resultsDir, { recursive: true });
  const slug = `${r.date}-${a.model.replace(/[^\w.-]+/g, "_")}-real`;
  writeFileSync(join(a.resultsDir, `${slug}.json`), `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(a.resultsPage ?? join(a.resultsDir, "..", "RESULTS.md"), resultsPage(a.resultsDir));
  d.print("");
  for (const s of r.datasets)
    for (const c of s.checks) d.print(`${s.dataset} ${c.id} ${c.pass ? "pass" : "FAIL"}: ${c.about} — ${c.detail}`);
  d.print(`results: ${join(a.resultsDir, `${slug}.json`)}`);
  return r;
}

/** RESULTS.md: the latest result per model and suite, full suites first, then the real-data tier. */
export function resultsPage(dir: string): string {
  const files = existsSync(dir)
    ? readdirSync(dir)
        // Baseline smoke runs are local (gitignored), so the page leaves them out and rebuilds the same from a clone.
        .filter((f) => f.endsWith(".json") && !f.endsWith("-baseline-smoke.json"))
        .sort()
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as SuiteResult | RealSuiteResult)
    : [];
  const all = files.filter((r): r is SuiteResult => r.suite !== "real");
  const latestReal = new Map<string, RealSuiteResult>();
  for (const r of files) if (r.suite === "real") latestReal.set(r.model, r);
  const latest = new Map<string, SuiteResult>();
  for (const r of all) latest.set(`${r.suite} ${r.model}`, r);
  const ordered = [...latest.values()].sort((x, y) => (x.suite === y.suite ? x.model.localeCompare(y.model) : x.suite === "full" ? -1 : 1));
  const real = [...latestReal.values()].sort((x, y) => x.model.localeCompare(y.model));
  return [
    "# Eval results",
    "",
    "Generated by `aa eval` from `evals/results/*.json` (docs/EVALS.md §4). Each table is the latest run of one model on one suite. Weak results are shown, not hidden.",
    "",
    "Datasets: 30 generated businesses (`evals/generator`, 10 archetypes × 3 variants) with planted events, distractors and data-quality issues. Retrieval recall@8 and the injection suite run separately (`bun run --filter @agentic-analytics/retrieval eval:retrieval`, `bunx vitest run packages/core/test/injection.test.ts`).",
    "",
    "No held-out set: the engine's detection and ranking rules (M11, M13a) were tuned on these same 30 datasets, so every score here is optimistic for unseen data. Of the Groq tables, the three single-model smoke runs (gpt-oss-120b, gpt-oss-20b, qwen3.8-27b alone) predate the M13a engine changes (seasonal guard, ranking, driver split, grouping dimensions). The \"planner, extractor, judge\" smoke run used the M13a engine, before the merge's representative-rule fix (a template with no measured change keeps its priority), which changes nothing per dataset on the offline baseline. Its full run (2026-10-20/21, over two nights) used the engine just before the M14a fixes (#44–#49) and the scoring before code-quality fix 9: it is the *before* of the M14a before/after, and the after run follows. A run with unfinished jobs is partial: its rates count those jobs as misses and its pass column reads n/a. A nightly run is carried over two passes (`aa eval --passes 2`, scripts/eval-daily.sh): a job the first night's quota stopped runs again the next night, and the run is partial only if jobs are still unfinished after that. The ten v3 datasets changed on 2026-10-22 (code-quality fix 11b: their noise blip moved from 2025-12 to 2025-11, off the planted December peak): v3 rows of runs before that date used the old data.",
    "",
    ...(ordered.length ? ordered.map(resultsMarkdown) : ["No results yet."]),
    "## Real public data",
    "",
    "Public datasets run as they are published (evals/real/README.md): `bun run eval:real:fetch` downloads them and checks every SHA-256, `bun run eval:real` runs the engine and scores each report against the answer files in `evals/real/answers/`. Each check reads only report.json, and its expected numbers come from SQL written in the answer file. A failed check is an engine gap, listed in docs/progress/STATE.md; checks are not tuned to pass.",
    "",
    ...(real.length ? real.map(realResultsMarkdown) : ["No real-data runs yet.", ""]),
  ].join("\n");
}
