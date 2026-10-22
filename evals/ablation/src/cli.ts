// `bun run eval:ablation -- --arms A,B,C --suite smoke|golden --model baseline|<provider:model>` (docs/specs/accuracy.md
// §8.5). Its own script, not an `aa` subcommand: the engine's CLI never carries model-written SQL (run_sql) or arm A's
// raw-text prompts, and nothing under packages/ or apps/ imports this package (a test checks).
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { coffeePlanner } from "@agentic-analytics/core/testing";
import { baselineModel } from "@agentic-analytics/eval-runner";
import { type CallRecord, type Env, type ModelClient, profileFor, Router } from "@agentic-analytics/models";
import type { Embedder } from "@agentic-analytics/retrieval";
import { AblationError } from "./errors.ts";
import { type AblationJob, type AblationSuite, COFFEE_GOLDEN, coffeeGoldenJob, realGoldenJobs, smokeJobs } from "./jobs.ts";
import { armModelClient } from "./models.ts";
import { ablationLines, ablationMarkdown } from "./report.ts";
import { type AblationResult, ARMS, type Arm, runAblation } from "./run.ts";
import { scriptedArmA, scriptedArmB } from "./scripted.ts";

/** Arm A's context window when the model's profile doesn't give one. */
export const DEFAULT_CONTEXT_TOKENS = 32_768;

export interface AblationArgs {
  readonly arms: readonly Arm[];
  readonly suite: AblationSuite;
  /** "baseline" (scripted, offline) or a provider route used for every role in every arm. */
  readonly model: string;
  readonly dataset?: string;
  readonly contextTokens: number;
  /** False with --no-tools, or when the model's profile says it can't call tools. */
  readonly tools: boolean;
  readonly resultsDir: string;
  readonly dataDir: string;
  readonly answersDir: string;
}

/** The raw flags, as parsed by the script. */
export interface AblationFlags {
  readonly arms?: string;
  readonly suite?: string;
  readonly model?: string;
  readonly dataset?: string;
  readonly context?: string;
  readonly "no-tools"?: boolean;
  readonly "results-dir"?: string;
  readonly data?: string;
  readonly answers?: string;
}

/** Checks the flags and fills the defaults; a bad flag is a USAGE error naming what it takes. */
export function ablationArgs(f: AblationFlags, defaults: { resultsDir: string; dataDir: string; answersDir: string }): AblationArgs {
  const arms = (f.arms ?? "A,B,C").split(",").map((a) => a.trim().toUpperCase());
  const bad = arms.filter((a) => !ARMS.includes(a as Arm));
  if (bad.length || !arms.length) throw new AblationError("USAGE", `--arms takes A, B and/or C (comma-separated), not ${bad.join(", ")}`);
  const suite = f.suite ?? "smoke";
  if (suite !== "smoke" && suite !== "golden") throw new AblationError("USAGE", `--suite is smoke or golden, not ${suite}`);
  const model = f.model ?? "baseline";
  if (model === "configured")
    throw new AblationError("USAGE", "--model takes baseline or one provider route (the same model in every arm), not configured");
  const context = f.context === undefined ? (profileFor(model)?.contextTokens ?? DEFAULT_CONTEXT_TOKENS) : Number(f.context);
  if (!Number.isInteger(context) || context < 1024)
    throw new AblationError("USAGE", `--context is a whole number of tokens ≥ 1024, not ${f.context}`);
  return {
    arms: [...new Set(arms as Arm[])],
    suite,
    model,
    ...(f.dataset ? { dataset: f.dataset } : {}),
    contextTokens: context,
    tools: !f["no-tools"] && profileFor(model)?.toolCalling !== "none",
    resultsDir: f["results-dir"] ?? defaults.resultsDir,
    dataDir: f.data ?? defaults.dataDir,
    answersDir: f.answers ?? defaults.answersDir,
  };
}

/** The jobs of a run: the smoke datasets, the CI mini golden set, or the real golden sets. */
export function ablationJobs(a: Pick<AblationArgs, "suite" | "dataset" | "dataDir" | "answersDir">): AblationJob[] {
  if (a.suite === "smoke") return smokeJobs(a.dataset);
  if (a.dataset === COFFEE_GOLDEN) return [coffeeGoldenJob()];
  return realGoldenJobs({ dataDir: a.dataDir, answersDir: a.answersDir, ...(a.dataset ? { only: a.dataset } : {}) });
}

/** The scripted clients: canned arm A and B answers, and the engine's scripted planner for arm C. */
export function scriptedClient(arm: Arm, job: AblationJob): ModelClient {
  if (arm === "A") return scriptedArmA(job);
  if (arm === "B") return scriptedArmB(job);
  return job.id === COFFEE_GOLDEN ? coffeePlanner() : baselineModel();
}

export const ablationSlug = (r: Pick<AblationResult, "date" | "model" | "suite">, dataset?: string) =>
  `${r.date}-${r.model.toLowerCase().replace(/[^a-z0-9.]+/g, "-")}-${r.suite}${dataset ? `-${dataset}` : ""}`;

export interface AblationDeps {
  readonly env: Env;
  readonly embedder: Embedder;
  readonly print: (line: string) => void;
  /** Injected in tests (a stubbed transport); the global fetch otherwise. */
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

/**
 * Runs the ablation and writes `<results dir>/ablation/<date>-<model>-<suite>[-<dataset>].json` and `.md`. With a real
 * model, each arm has its own client (no response cache) and the calls go to `<same name>.calls.jsonl`, never the
 * engine's call log.
 */
export async function ablationCommand(a: AblationArgs, d: AblationDeps): Promise<{ result: AblationResult; files: string[] }> {
  const jobs = ablationJobs(a);
  const scripted = a.model === "baseline";
  const now = d.now ?? (() => new Date());
  const dir = join(a.resultsDir, "ablation");
  const slug = ablationSlug({ date: now().toISOString().slice(0, 10), model: a.model, suite: a.suite }, a.dataset);
  const logFile = join(dir, `${slug}.calls.jsonl`);
  const routers = { A: new Router(), B: new Router(), C: new Router() };
  const client = (arm: Arm, job: AblationJob): ModelClient =>
    scripted
      ? scriptedClient(arm, job)
      : armModelClient(a.model, {
          env: d.env,
          router: routers[arm],
          ...(d.fetch ? { fetch: d.fetch } : {}),
          log: (c: CallRecord) => {
            mkdirSync(dir, { recursive: true });
            appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), arm, job: job.id, ...c })}\n`);
          },
        });
  if (!a.tools && a.arms.includes("B")) d.print(`arm B skipped: ${a.model} can't call tools, so it runs arm A only`);
  const result = await runAblation({
    suite: a.suite,
    arms: a.arms,
    jobs,
    model: a.model,
    scripted,
    contextTokens: a.contextTokens,
    tools: a.tools,
    client,
    embedder: d.embedder,
    now,
    onJob: d.print,
  });
  mkdirSync(dir, { recursive: true });
  const json = join(dir, `${slug}.json`);
  const md = join(dir, `${slug}.md`);
  writeFileSync(json, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(md, ablationMarkdown(result));
  for (const line of ablationLines(result)) d.print(line);
  d.print(`wrote ${json} and ${md}`);
  return { result, files: [json, md] };
}
