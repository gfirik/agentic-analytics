// `bun run eval:golden` (docs/specs/accuracy.md §4): scores a real dataset's golden set offline. It runs the engine
// job on the derived file exactly as the real tier does (runRealJob), asks each `ask` item's question of the finished
// job (`aa ask`), and scores every item with scoreGoldenItem. The golden files live beside this package
// (evals/golden/<dataset>/), and only this module maps a split to its file: nothing under packages/ or apps/ names
// the held-out file (a test checks).
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Answer, askJob } from "@agentic-analytics/core";
import { type ModelClient, ModelError } from "@agentic-analytics/models";
import type { Embedder } from "@agentic-analytics/retrieval";
import { baselineModel } from "./baseline.ts";
import { EvalRunError } from "./errors.ts";
import {
  type GoldenItem,
  type GoldenScore,
  type GoldenSet,
  type GoldenSummary,
  parseGoldenSet,
  scoreGoldenItem,
  summarizeGolden,
} from "./golden.ts";
import { loadRealAnswers, readRealFile, runRealJob } from "./real.ts";

export type GoldenSplit = GoldenItem["split"];

/** evals/golden in a checkout. */
export const GOLDEN_DIR = join(import.meta.dirname, "..", "..", "golden");

/** The file of one split: golden.yaml (dev) or heldout.yaml (held-out, release runs only). */
export function goldenFile(goldenDir: string, dataset: string, split: GoldenSplit): string {
  return join(goldenDir, dataset, split === "dev" ? "golden.yaml" : "heldout.yaml");
}

/** Reads one split's golden set, checking it is about `dataset` and every item is of that split. */
export function loadGoldenSet(goldenDir: string, dataset: string, split: GoldenSplit): GoldenSet {
  const file = goldenFile(goldenDir, dataset, split);
  if (!existsSync(file)) throw new EvalRunError("UNKNOWN_DATASET", `no ${split} golden set for ${dataset} (${file})`);
  const set = parseGoldenSet(readFileSync(file, "utf8"));
  if (set.dataset !== dataset) throw new EvalRunError("BAD_RESULTS", `${file} is about ${set.dataset}, not ${dataset}`);
  const stray = set.items.filter((i) => i.split !== split).map((i) => i.id);
  if (stray.length) throw new EvalRunError("BAD_RESULTS", `${file} holds items of another split: ${stray.join(", ")}`);
  return set;
}

export interface GoldenItemResult extends GoldenScore {
  readonly question: string;
  readonly source: GoldenItem["source"]["kind"];
  /** The expected answer as written in the golden file (a refusal for a trap). */
  readonly expected: string;
}

export interface GoldenRunResult {
  readonly dataset: string;
  readonly split: GoldenSplit;
  readonly model: string;
  readonly completed: boolean;
  readonly error?: string;
  readonly seconds: number;
  readonly items: readonly GoldenItemResult[];
  readonly summary: GoldenSummary;
}

export interface GoldenRunOptions {
  readonly dataset: string;
  readonly split: GoldenSplit;
  /** A fresh model client per call site (scripted models keep state): one for the job, one per question. */
  readonly model: () => ModelClient;
  readonly modelName: string;
  readonly embedder: Embedder;
  /** evals/real/data (fetched files) and evals/real/answers (the job's file and options). */
  readonly dataDir: string;
  readonly answersDir: string;
  readonly goldenDir?: string;
}

const expectedOf = (i: GoldenItem): string => (i.kind === "trap" ? "refusal" : String(i.expected));

/**
 * Runs one dataset's job and scores one split of its golden set. A job that fails scores every item as a miss; a
 * question the model can't answer (the scripted baseline answers none) is "no answer", a miss, never n/a.
 */
export async function runGoldenSet(o: GoldenRunOptions): Promise<GoldenRunResult> {
  const set = loadGoldenSet(o.goldenDir ?? GOLDEN_DIR, o.dataset, o.split);
  const entry = loadRealAnswers(o.answersDir).find((a) => a.answers.dataset === o.dataset);
  if (!entry) throw new EvalRunError("UNKNOWN_DATASET", `no answer file for ${o.dataset} in ${o.answersDir}`);
  const { answers } = entry;
  if (!existsSync(join(o.dataDir, answers.file)))
    throw new EvalRunError(
      "NO_DATA",
      `${answers.file} is missing in ${o.dataDir}; for the public datasets run \`bun run eval:real:fetch\` first`,
    );
  const started = Date.now();
  const { bytes } = readRealFile(answers, o.dataDir);
  const dir = mkdtempSync(join(tmpdir(), `aa-golden-${o.dataset}-`));
  const items: GoldenItemResult[] = [];
  let error: string | undefined;
  try {
    const report = await runRealJob(answers, entry.dir, bytes, dir, { model: o.model(), embedder: o.embedder }).catch((err: unknown) => {
      error = err instanceof Error ? err.message : String(err);
      return undefined;
    });
    for (const item of set.items) {
      const about = { question: item.question, source: item.source.kind, expected: expectedOf(item) };
      if (!report) {
        items.push({
          id: item.id,
          kind: item.kind,
          split: item.split,
          pass: false,
          got: "no report",
          counts: item.review?.agrees === true,
          ...about,
        });
        continue;
      }
      let answer: Answer | undefined;
      let askError: string | undefined;
      if (item.source.kind === "ask")
        answer = await askJob(dir, item.question, o.model()).catch((err: unknown) => {
          // A model or provider failure is that item's miss; anything else is a bug and stops the run.
          if (!fromModel(err)) throw err;
          askError = (err instanceof Error ? err.message : String(err)).split("\n")[0]?.slice(0, 160);
          return undefined;
        });
      const s = scoreGoldenItem(item, report, answer);
      items.push({ ...s, ...(askError ? { got: `no answer (${askError})` } : {}), ...about });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return {
    dataset: o.dataset,
    split: o.split,
    model: o.modelName,
    completed: error === undefined,
    ...(error ? { error } : {}),
    seconds: (Date.now() - started) / 1000,
    items,
    summary: summarizeGolden(items, o.split),
  };
}

/** The datasets with a golden set of this split and an answer file (the real datasets; not the CI fixture). */
export function goldenDatasets(goldenDir: string, answersDir: string, split: GoldenSplit): string[] {
  return loadRealAnswers(answersDir)
    .map((a) => a.answers.dataset)
    .filter((d) => existsSync(goldenFile(goldenDir, d, split)));
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

/** One printed line per item, then the dataset's summary. */
export function goldenLines(r: GoldenRunResult): string[] {
  const s = r.summary;
  const passed = r.items.filter((i) => i.pass).length;
  return [
    `${r.dataset} (${r.split}, ${r.model})${r.completed ? "" : ` job failed: ${r.error}`}: ${passed}/${r.items.length} pass · ${r.seconds.toFixed(1)} s`,
    ...r.items.map(
      (i) =>
        `  ${pad(i.id, 4)} ${i.pass ? "pass" : "MISS"} ${pad(i.kind, 11)} ${pad(i.source, 6)} expected ${i.expected}; got ${i.got} — ${i.question}`,
    ),
    `  counted toward the bars: ${s.numericCategorical.passed}/${s.numericCategorical.of} numeric and categorical, ${s.traps.passed}/${s.traps.of} traps; ${s.notCounted} not counted (unreviewed or disagreed)`,
  ];
}

export interface GoldenEvalArgs {
  /** "baseline" (the scripted heuristic, no LLM) or a model name used for every role. */
  readonly model: string;
  /** One dataset, or every real dataset with a golden set of this split. */
  readonly dataset?: string;
  readonly split: GoldenSplit;
  readonly dataDir: string;
  readonly answersDir: string;
  readonly goldenDir?: string;
}

/** `aa eval --suite golden` (`bun run eval:golden`): prints per-item results and the bars' counts per dataset. */
export async function goldenEvalCommand(
  a: GoldenEvalArgs,
  d: { readonly modelFor?: (name: string) => ModelClient; readonly embedder: Embedder; readonly print: (line: string) => void },
): Promise<GoldenRunResult[]> {
  const isBaseline = a.model === "baseline";
  if (!isBaseline && !d.modelFor) throw new EvalRunError("NO_MODEL", `no model client for ${a.model}`);
  const goldenDir = a.goldenDir ?? GOLDEN_DIR;
  const datasets = a.dataset ? [a.dataset] : goldenDatasets(goldenDir, a.answersDir, a.split);
  if (!datasets.length) throw new EvalRunError("UNKNOWN_DATASET", `no ${a.split} golden sets in ${goldenDir}`);
  const out: GoldenRunResult[] = [];
  for (const dataset of datasets) {
    const r = await runGoldenSet({
      dataset,
      split: a.split,
      model: isBaseline ? () => baselineModel() : () => (d.modelFor as NonNullable<typeof d.modelFor>)(a.model),
      modelName: a.model,
      embedder: d.embedder,
      dataDir: a.dataDir,
      answersDir: a.answersDir,
      goldenDir,
    });
    for (const line of goldenLines(r)) d.print(line);
    out.push(r);
  }
  return out;
}

/** Whether an error is a model failure: a ModelError, or one the agent wrapped (its `cause` chain). */
function fromModel(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) if (e instanceof ModelError) return true;
  return false;
}
