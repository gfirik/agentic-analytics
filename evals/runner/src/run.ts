// The eval runner (docs/EVALS.md §3): runs every dataset of a suite as a full job with the given model, scores each
// report against its answer key, and writes `evals/results/<date>-<model>.json` plus the markdown table that
// RESULTS.md collects. Jobs run one at a time in temporary folders that are removed afterwards.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type JobOptions, runJob } from "@agentic-analytics/core";
import { type Dataset, generatedDatasets } from "@agentic-analytics/eval-generator";
import type { CallRecord, ModelClient } from "@agentic-analytics/models";
import type { Embedder } from "@agentic-analytics/retrieval";
import type { Report } from "@agentic-analytics/schema";
import { type Bar, type DatasetScore, scoreReport, summarize } from "./score.ts";

export type Suite = "smoke" | "full";

/** Smoke: three datasets across archetypes and every variant (EVALS §3). Full: all 30. */
export function suiteDatasets(suite: Suite, all: readonly Dataset[] = generatedDatasets()): Dataset[] {
  if (suite === "full") return [...all];
  const pick = ["coffee_roaster-v1", "saas-v2", "restaurant-v3"];
  return all.filter((d) => pick.includes(d.id));
}

/** Calls per route (role · provider · model as sent), with how many came from the cache. */
export interface RouteUse {
  readonly role: string;
  readonly route: string;
  readonly calls: number;
  readonly cached: number;
  readonly failed: number;
}

export function routeSummary(calls: readonly CallRecord[]): RouteUse[] {
  const m = new Map<string, { role: string; route: string; calls: number; cached: number; failed: number }>();
  for (const c of calls) {
    const route = `${c.provider}${c.endpoint ? `:${c.endpoint}` : ""}:${c.model}`;
    const k = `${c.role ?? "?"} ${route}`;
    const u = m.get(k) ?? { role: c.role ?? "?", route, calls: 0, cached: 0, failed: 0 };
    u.calls++;
    if (c.cached) u.cached++;
    if (c.status >= 400) u.failed++;
    m.set(k, u);
  }
  return [...m.values()].sort((a, b) => a.role.localeCompare(b.role) || a.route.localeCompare(b.route));
}

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
  readonly model: (onCall: (c: CallRecord) => void) => ModelClient;
  readonly modelName: string;
  readonly note?: string;
  readonly embedder: Embedder;
  readonly smallModel?: boolean;
  readonly datasets?: readonly Dataset[];
  readonly onDataset?: (s: DatasetScore, i: number, n: number) => void;
  /** Keep each report as `<dir>/<dataset>.json` (real-model runs cost tokens; this lets them be inspected later). */
  readonly keepReports?: string;
  readonly now?: () => Date;
}

export async function runSuite(o: RunOptions): Promise<SuiteResult> {
  const datasets = o.datasets ?? suiteDatasets(o.suite);
  const scores: DatasetScore[] = [];
  const t0 = Date.now();
  for (const [i, ds] of datasets.entries()) {
    const dir = mkdtempSync(join(tmpdir(), `aa-eval-${ds.id}-`));
    const calls: CallRecord[] = [];
    const { model, tokens } = counting(o.model((c) => calls.push(c)));
    const started = Date.now();
    const options: JobOptions = {
      today: ds.answers.today,
      currency: ds.answers.currency,
      ...(o.smallModel ? { smallModel: true } : {}),
    };
    let score: DatasetScore;
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
      rmSync(dir, { recursive: true, force: true });
    }
    scores.push({ ...score, routes: routeSummary(calls) });
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
    routes: mergeRoutes(scores.flatMap((s) => s.routes ?? [])),
    seconds: (Date.now() - t0) / 1000,
    tokens: {
      input: scores.reduce((a, s) => a + s.tokens.input, 0),
      output: scores.reduce((a, s) => a + s.tokens.output, 0),
    },
  };
}

/** Sums route uses over datasets. */
export function mergeRoutes(uses: readonly RouteUse[]): RouteUse[] {
  const m = new Map<string, RouteUse>();
  for (const u of uses) {
    const k = `${u.role} ${u.route}`;
    const prev = m.get(k);
    m.set(k, prev ? { ...prev, calls: prev.calls + u.calls, cached: prev.cached + u.cached, failed: prev.failed + u.failed } : u);
  }
  return [...m.values()].sort((a, b) => a.role.localeCompare(b.role) || a.route.localeCompare(b.route));
}
const pct = (v: number | undefined) => (v === undefined ? "n/a" : `${(v * 100).toFixed(1)}%`);

/** One model's results as markdown: the bars, then one line per dataset. */
export function resultsMarkdown(r: SuiteResult): string {
  const lines = [
    `### ${r.model} · ${r.suite} suite · ${r.date}`,
    "",
    ...(r.note ? [r.note, ""] : []),
    `${r.datasets} datasets · ${r.seconds.toFixed(0)} s · ${r.tokens.input + r.tokens.output} tokens`,
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
      (b) =>
        `| ${b.metric} | ${b.metric === "Number mismatches" ? String(b.value) : pct(b.value)} | ${b.bar} | ${b.pass === undefined ? "n/a" : b.pass ? "yes" : "**no**"} |`,
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
    return report && key && s.completed ? scoreReport(report, key, { seconds: s.seconds, tokens: s.tokens }) : s;
  });
  return { ...r, scores, bars: summarize(scores) };
}
