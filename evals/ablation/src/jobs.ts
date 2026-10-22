// The ablation's jobs (docs/specs/accuracy.md §8.1): the same tasks for every arm. The smoke suite's three generated
// datasets (one "what changed" task each, scored against planted events and distractors) and the golden sets (one
// task per dev-split item; the CI mini set over the committed coffee-roaster dataset, or the real datasets).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Answer, askJob, runJob } from "@agentic-analytics/core";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import type { AnswerKey } from "@agentic-analytics/eval-generator";
import {
  GOLDEN_DIR,
  type GoldenItem,
  goldenFile,
  loadGoldenSet,
  loadRealAnswers,
  parseGoldenSet,
  readRealFile,
  runRealJob,
  suiteDatasets,
} from "@agentic-analytics/eval-runner";
import type { InputFile } from "@agentic-analytics/ingest";
import type { ModelClient } from "@agentic-analytics/models";
import type { Embedder } from "@agentic-analytics/retrieval";
import type { Report } from "@agentic-analytics/schema";
import { AblationError } from "./errors.ts";

export type AblationSuite = "smoke" | "golden";

/** The committed mini golden set (evals/golden/coffee-roaster), the CI fixture. */
export const COFFEE_GOLDEN = "coffee-roaster";

export interface AblationJob {
  readonly id: string;
  readonly files: readonly InputFile[];
  /** Smoke: the dataset's answer key and its months. */
  readonly key?: AnswerKey;
  /** Golden: the dev-split items. */
  readonly items?: readonly GoldenItem[];
  /** Arm C: the engine's job in `dir`. */
  readonly runEngine: (dir: string, deps: { readonly model: ModelClient; readonly embedder: Embedder }) => Promise<Report>;
  /** Arm C: an `aa ask` question on the finished job. */
  readonly ask: (dir: string, question: string, model: ModelClient) => Promise<Answer>;
}

const filesOf = (files: Readonly<Record<string, Uint8Array>>): InputFile[] =>
  Object.entries(files).map(([name, bytes]) => ({ name, bytes }));

/**
 * The smoke suite's development datasets (coffee_roaster-v1, saas-v2, restaurant-v3), as the main eval runs them. The
 * smoke suite's held-out dataset is left out: the ablation is a development tool, and the held-out generated set is
 * scored only by release runs (docs/specs/accuracy.md §9).
 */
export function smokeJobs(only?: string): AblationJob[] {
  const all = suiteDatasets("smoke").filter((d) => d.answers.split !== "heldout");
  const picked = only ? all.filter((d) => d.id === only) : all;
  if (!picked.length) throw new AblationError("USAGE", `${only} is not in the smoke suite (${all.map((d) => d.id).join(", ")})`);
  return picked.map((ds) => ({
    id: ds.id,
    files: filesOf(ds.files),
    key: ds.answers,
    runEngine: async (dir, deps) =>
      (
        await runJob(
          { dir, jobId: ds.id, files: filesOf(ds.files), options: { today: ds.answers.today, currency: ds.answers.currency } },
          deps,
        )
      ).report,
    ask: askJob,
  }));
}

/** The CI mini golden set: six items over the committed coffee-roaster dataset (accuracy.md §3). */
export function coffeeGoldenJob(goldenDir = GOLDEN_DIR): AblationJob {
  const set = parseGoldenSet(readFileSync(goldenFile(goldenDir, COFFEE_GOLDEN, "dev"), "utf8"));
  return {
    id: COFFEE_GOLDEN,
    files: filesOf(coffeeRoasterFiles()),
    items: set.items,
    runEngine: async (dir, deps) =>
      (await runJob({ dir, files: filesOf(coffeeRoasterFiles()), options: { today: "2026-07-01", currency: "USD" } }, deps)).report,
    ask: askJob,
  };
}

/**
 * The real datasets' golden sets (dev split only: held-out items are scored only in release runs), each with its
 * fetched file; `NO_DATA` when a file is missing (run `bun run eval:real:fetch` first).
 */
export function realGoldenJobs(o: { dataDir: string; answersDir: string; goldenDir?: string; only?: string }): AblationJob[] {
  const goldenDir = o.goldenDir ?? GOLDEN_DIR;
  const entries = loadRealAnswers(o.answersDir).filter(
    (e) => (!o.only || e.answers.dataset === o.only) && existsSync(goldenFile(goldenDir, e.answers.dataset, "dev")),
  );
  if (!entries.length) throw new AblationError("USAGE", `no dev golden set${o.only ? ` for ${o.only}` : ""} with an answer file`);
  return entries.map(({ answers, dir: answersDir }) => {
    if (!existsSync(join(o.dataDir, answers.file)))
      throw new AblationError("NO_DATA", `${answers.file} is missing in ${o.dataDir}; run \`bun run eval:real:fetch\` first`);
    const { bytes } = readRealFile(answers, o.dataDir);
    return {
      id: answers.dataset,
      files: [{ name: answers.file, bytes }],
      items: loadGoldenSet(goldenDir, answers.dataset, "dev").items,
      runEngine: (dir, deps) => runRealJob(answers, answersDir, bytes, dir, deps),
      ask: askJob,
    };
  });
}

/** The months a smoke dataset covers, for the "what changed" task. */
export const periodOf = (key: AnswerKey) => ({ from: key.period.from, to: key.period.to });
