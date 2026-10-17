// `aa eval --suite smoke|full --model baseline|configured|<provider:model>` (docs/EVALS.md §3): runs the suite,
// writes `evals/results/<date>-<model>-<suite>.json` and regenerates `evals/RESULTS.md` from every results file.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CallRecord, ModelClient } from "@agentic-analytics/models";
import type { Embedder } from "@agentic-analytics/retrieval";
import { baselineModel } from "./baseline.ts";
import { EvalRunError } from "./errors.ts";
import { missingRealData, type RealSuiteResult, realResultsMarkdown, runRealSuite } from "./real.ts";
import { resultsMarkdown, runSuite, type Suite, type SuiteResult } from "./run.ts";

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

export async function evalCommand(a: EvalArgs, d: EvalDeps): Promise<SuiteResult> {
  const baseline = a.model === "baseline";
  if (!baseline && !d.modelFor) throw new EvalRunError("NO_MODEL", `no model client for ${a.model}`);
  const make = baseline
    ? () => baselineModel({ small: a.smallModel === true })
    : (onCall: (c: CallRecord) => void) => (d.modelFor as NonNullable<EvalDeps["modelFor"]>)(a.model, onCall);
  const r = await runSuite({
    suite: a.suite,
    model: make,
    modelName: a.model + (a.smallModel ? " (small-model mode)" : ""),
    ...(baseline ? { note: BASELINE_NOTE } : {}),
    embedder: d.embedder,
    ...(a.smallModel ? { smallModel: true } : {}),
    ...(a.keepReports ? { keepReports: a.keepReports } : {}),
    ...(d.now ? { now: d.now } : {}),
    onDataset: (s, i, n) =>
      d.print(
        `[${i + 1}/${n}] ${s.dataset}: ${s.completed ? `${s.planted.filter((p) => p.detected).length}/${s.planted.length} planted found` : `failed (${s.error})`} · ${s.seconds.toFixed(1)} s`,
      ),
  });
  mkdirSync(a.resultsDir, { recursive: true });
  const slug = `${r.date}-${a.model.replace(/[^\w.-]+/g, "_")}${a.smallModel ? "-small" : ""}-${a.suite}`;
  writeFileSync(join(a.resultsDir, `${slug}.json`), `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(a.resultsPage ?? join(a.resultsDir, "..", "RESULTS.md"), resultsPage(a.resultsDir));
  d.print("");
  for (const b of r.bars)
    d.print(
      `${b.metric}: ${b.value === undefined ? "n/a" : b.metric === "Number mismatches" ? b.value : `${(b.value * 100).toFixed(1)}%`} (bar ${b.bar})`,
    );
  d.print(`results: ${join(a.resultsDir, `${slug}.json`)}`);
  return r;
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
    "No held-out set: the engine's detection and ranking rules (M11, M13a) were tuned on these same 30 datasets, so every score here is optimistic for unseen data. Of the Groq tables, the three single-model smoke runs (gpt-oss-120b, gpt-oss-20b, qwen3.8-27b alone) predate the M13a engine changes (seasonal guard, ranking, driver split, grouping dimensions). The \"planner, extractor, judge\" smoke and full runs used the M13a engine, before the merge's representative-rule fix (a template with no measured change keeps its priority), which changes nothing per dataset on the offline baseline. A run with unfinished jobs is partial: its rates count those jobs as misses and its pass column reads n/a.",
    "",
    ...(ordered.length ? ordered.map(resultsMarkdown) : ["No results yet."]),
    "## Real public data",
    "",
    "Public datasets run as they are published (evals/real/README.md): `bun run eval:real:fetch` downloads them and checks every SHA-256, `bun run eval:real` runs the engine and scores each report against the answer files in `evals/real/answers/`. Each check reads only report.json, and its expected numbers come from SQL written in the answer file. A failed check is an engine gap, listed in docs/progress/STATE.md; checks are not tuned to pass.",
    "",
    ...(real.length ? real.map(realResultsMarkdown) : ["No real-data runs yet.", ""]),
  ].join("\n");
}
