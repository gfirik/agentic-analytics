// The ablation run (docs/specs/accuracy.md §8): every job's tasks through each requested arm, with the same model,
// the same tasks and the same scoring; then the measures per arm and the paired differences with their bootstrap
// intervals. Arm B's database and temp directory live in a per-run folder that is deleted after the run.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Answer } from "@agentic-analytics/core";
import {
  type GoldenItem,
  type PairedDifference,
  type PlantedScore,
  pairedBootstrap,
  scoreGoldenItem,
  scoreReport,
} from "@agentic-analytics/eval-runner";
import type { ModelClient } from "@agentic-analytics/models";
import type { Embedder } from "@agentic-analytics/retrieval";
import type { Report } from "@agentic-analytics/schema";
import { type ArmRun, fromModel, runArmA, runArmB, type Task } from "./arms.ts";
import { type AblationJob, type AblationSuite, periodOf } from "./jobs.ts";
import {
  type ChangesScore,
  changesMeasures,
  citationValid,
  goldenMeasures,
  type ItemScore,
  plantedFound,
  type Rate,
  rate,
  type Support,
  scoreArmChanges,
  scoreArmItem,
  unsupportedNumbers,
} from "./measures.ts";
import { counting } from "./models.ts";
import type { ChangesAnswer, QuestionAnswer } from "./prompts.ts";
import { buildSourceDatabase, DEFAULT_LIMITS, type SandboxLimits, SqlSandbox } from "./sandbox.ts";
import { type ArmACut, readSources, type Sources } from "./sources.ts";

export type Arm = "A" | "B" | "C";
export const ARMS: readonly Arm[] = ["A", "B", "C"];

export interface AblationOptions {
  readonly suite: AblationSuite;
  readonly arms: readonly Arm[];
  readonly jobs: readonly AblationJob[];
  /** The model's name, as the results show it; "baseline" for the scripted run. */
  readonly model: string;
  /** Scripted (FakeModel) arms: the results are labelled harness checks. */
  readonly scripted: boolean;
  /** The model's context window in tokens (arm A's cut). */
  readonly contextTokens: number;
  /** False when the model can't call tools: arm B is skipped (analyst-grade §4.5). */
  readonly tools: boolean;
  /** One client per arm and job; arm C's is the engine's (a fresh one per call site, scripted models keep state). */
  readonly client: (arm: Arm, job: AblationJob) => ModelClient;
  readonly embedder: Embedder;
  readonly limits?: SandboxLimits;
  /** Where arm B's per-run folders go (default the OS temp dir). */
  readonly workDir?: string;
  readonly now?: () => Date;
  readonly onJob?: (line: string) => void;
}

export interface ArmTaskResult {
  readonly task: string;
  /** 1 when the task passed (a golden item, or a planted event found with its driver), else 0: the paired score. */
  readonly score: number;
  readonly got: string;
  readonly answer?: unknown;
  readonly error?: string;
  readonly queries?: ArmRun["queries"];
  readonly citation?: boolean;
  readonly numbers?: { readonly claimed: number; readonly unsupported: number; readonly unsupportedWithoutCells: number };
}

export interface ArmJobResult {
  readonly arm: Arm;
  readonly job: string;
  readonly tasks: readonly ArmTaskResult[];
  readonly golden?: readonly ItemScore[];
  readonly changes?: ChangesScore;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly seconds: number;
  /** Arm A: what the input held, stated beside its results. */
  readonly cut?: ArmACut;
  /** Arm B: the per-run folder was deleted after the run. */
  readonly cleanedUp?: boolean;
  readonly error?: string;
}

export interface ArmMeasures {
  readonly arm: Arm;
  readonly ran: boolean;
  readonly skipped?: string;
  // golden
  readonly numeric?: Rate;
  readonly categorical?: Rate;
  readonly traps?: Rate;
  readonly unsupported?: { readonly numbers: number; readonly unsupported: number; readonly unsupportedWithoutCells: number };
  readonly citations?: Rate;
  // smoke
  readonly recall5?: Rate;
  readonly driver?: Rate;
  readonly distractorFp?: Rate;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly seconds: number;
  /** Arm A's cuts, one per job that was cut. */
  readonly cuts?: readonly string[];
}

export interface Comparison {
  /** "C − A": the second arm minus the first, per task. */
  readonly pair: string;
  readonly tasks: number;
  readonly difference: PairedDifference;
  /** The interval excludes 0 with the later arm ahead (the only case "adds accuracy" may be said, §4.5). */
  readonly adds: boolean;
}

export interface AblationResult {
  readonly suite: AblationSuite;
  readonly model: string;
  readonly scripted: boolean;
  readonly date: string;
  readonly arms: readonly Arm[];
  readonly contextTokens: number;
  readonly jobs: readonly string[];
  readonly results: readonly ArmJobResult[];
  readonly measures: readonly ArmMeasures[];
  readonly comparisons: readonly Comparison[];
  /** Arm C's facts are in the unsupported-number support set only when arm C ran. */
  readonly supportHasFacts: boolean;
}

const tasksOf = (job: AblationJob): Task[] => [
  ...(job.items ?? []).map((i): Task => ({ kind: "question", id: i.id, question: i.question })),
  ...(job.key ? [{ kind: "changes" as const, id: job.id, period: periodOf(job.key) }] : []),
];

/** The numeric source cells of the columns each item refers to (its `columns`, by SQL name or original header). */
export function cellSupport(sources: Sources, items: readonly GoldenItem[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const item of items) {
    const wanted = new Set(item.columns.map((c) => c.toLowerCase()));
    const values: number[] = [];
    for (const t of sources.tables)
      for (const [ci, c] of t.columns.entries()) {
        if (!wanted.has(c.name.toLowerCase()) && !wanted.has(c.label.toLowerCase())) continue;
        for (const r of t.rows) {
          const v = r.values[ci];
          if (typeof v === "number" && Number.isFinite(v)) values.push(v);
        }
      }
    out.set(item.id, values);
  }
  return out;
}

/** Runs the ablation over every job; the arms run one after another per job, never in parallel (AGENTS §9). */
export async function runAblation(o: AblationOptions): Promise<AblationResult> {
  const arms = ARMS.filter((a) => o.arms.includes(a));
  // A model that can't call tools runs arm A only: arm B's run_sql and the engine's planner (arm C) both need tools.
  const runs = (a: Arm) => a === "A" || o.tools;
  const results: ArmJobResult[] = [];
  const support = new Map<string, Support>();
  for (const job of o.jobs) {
    const sources = await readSources(job.files);
    const items = job.items ?? [];
    const golden = items.filter((i) => i.kind === "numeric").map((i) => (i as Extract<GoldenItem, { kind: "numeric" }>).expected);
    let facts: number[] = [];
    if (arms.includes("C") && runs("C")) {
      const c = await runArmC(o, job);
      results.push(c.result);
      facts = c.facts;
    }
    support.set(job.id, { golden, facts, cells: cellSupport(sources, items) });
    const sup = support.get(job.id) as Support;
    if (arms.includes("A")) results.push(await runArmAJob(o, job, sources, sup));
    if (arms.includes("B") && runs("B")) results.push(await runArmBJob(o, job, sources, sup));
    o.onJob?.(`${job.id}: ${arms.filter(runs).join(", ")} done`);
  }
  const measures = arms.map((arm) => measuresOf(arm, results, o));
  return {
    suite: o.suite,
    model: o.model,
    scripted: o.scripted,
    date: (o.now ?? (() => new Date()))().toISOString().slice(0, 10),
    arms,
    contextTokens: o.contextTokens,
    jobs: o.jobs.map((j) => j.id),
    results,
    measures,
    comparisons: comparisons(arms.filter(runs), results),
    supportHasFacts: arms.includes("C") && runs("C"),
  };
}

/** Arm C: the engine's job, then each `ask` item's question; scored by the eval runner's own scorers. */
async function runArmC(o: AblationOptions, job: AblationJob): Promise<{ result: ArmJobResult; facts: number[] }> {
  const dir = mkdtempSync(join(o.workDir ?? tmpdir(), `aa-ablation-c-${job.id}-`));
  const started = Date.now();
  const engine = counting(o.client("C", job));
  let report: Report | undefined;
  let error: string | undefined;
  const facts: number[] = [];
  const tasks: ArmTaskResult[] = [];
  let golden: ItemScore[] | undefined;
  let changes: ChangesScore | undefined;
  const asked = { input: 0, output: 0 };
  try {
    report = await job.runEngine(dir, { model: engine.client, embedder: o.embedder }).catch((err: unknown) => {
      // As for the ask items: a model failure is this job's miss; anything else is a harness bug and stops the run.
      if (!fromModel(err)) throw err;
      error = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return undefined;
    });
    if (report) facts.push(...report.facts.map((f) => f.value));
    if (job.items) {
      golden = [];
      for (const item of job.items) {
        let answer: Answer | undefined;
        if (report && item.source.kind === "ask") {
          const asker = counting(o.client("C", job));
          // A model or provider failure is that item's miss; anything else is a bug and stops the run.
          answer = await job.ask(dir, item.question, asker.client).catch((err: unknown) => {
            if (!fromModel(err)) throw err;
            return undefined;
          });
          asked.input += asker.usage().inputTokens;
          asked.output += asker.usage().outputTokens;
          if (answer) facts.push(...answer.facts.map((f) => f.value));
        }
        const s = report ? scoreGoldenItem(item, report, answer) : { pass: false, got: "no report" };
        golden.push({ id: item.id, kind: item.kind, pass: s.pass, got: s.got });
        tasks.push({ task: item.id, score: s.pass ? 1 : 0, got: s.got });
      }
    }
    if (job.key) {
      const s = scoreReport(report, job.key, { seconds: 0, tokens: { input: 0, output: 0 } });
      changes = { planted: s.planted, distractorsReported: s.distractorsReported, distractors: s.distractors };
      tasks.push(...plantedTasks(changes.planted));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const usage = engine.usage();
  return {
    facts,
    result: {
      arm: "C",
      job: job.id,
      tasks,
      ...(golden ? { golden } : {}),
      ...(changes ? { changes } : {}),
      inputTokens: usage.inputTokens + asked.input,
      outputTokens: usage.outputTokens + asked.output,
      seconds: (Date.now() - started) / 1000,
      ...(error ? { error } : {}),
    },
  };
}

const plantedTasks = (planted: readonly PlantedScore[]): ArmTaskResult[] =>
  planted.map((p) => ({
    task: p.id,
    score: plantedFound(p) ? 1 : 0,
    got: p.detected ? `found at rank ${p.rank}${p.driver === false ? ", wrong driver" : ""}` : "not found",
  }));

/** Scores one arm A or B job's runs against the job's items or key. */
function scoreRuns(
  arm: "A" | "B",
  job: AblationJob,
  runs: readonly ArmRun[],
  support: Support,
  rerun?: ReadonlyMap<string, readonly (readonly unknown[])[] | undefined>,
): Pick<ArmJobResult, "tasks" | "golden" | "changes"> {
  const tasks: ArmTaskResult[] = [];
  const golden: ItemScore[] = [];
  let changes: ChangesScore | undefined;
  for (const run of runs) {
    const item = job.items?.find((i) => i.id === run.task);
    if (item) {
      const answer = run.answer as QuestionAnswer | undefined;
      const s = scoreArmItem(item, answer);
      golden.push(s);
      const u = unsupportedNumbers(item, answer, support);
      const citation = arm === "B" && rerun ? citationValid(item, answer, run.queries ?? [], rerun) : undefined;
      tasks.push({
        task: item.id,
        score: s.pass ? 1 : 0,
        got: run.error ? `no answer (${run.error})` : s.got,
        ...(run.answer ? { answer: run.answer } : {}),
        ...(run.error ? { error: run.error } : {}),
        ...(run.queries ? { queries: run.queries } : {}),
        ...(citation !== undefined ? { citation } : {}),
        numbers: { claimed: u.numbers, unsupported: u.unsupported, unsupportedWithoutCells: u.unsupportedWithoutCells },
      });
    } else if (job.key) {
      changes = scoreArmChanges(run.answer as ChangesAnswer | undefined, job.key);
      tasks.push(
        ...plantedTasks(changes.planted).map((t) => ({
          ...t,
          ...(run.error ? { error: run.error } : {}),
          ...(run.queries ? { queries: run.queries } : {}),
        })),
      );
    }
  }
  return { tasks, ...(job.items ? { golden } : {}), ...(changes ? { changes } : {}) };
}

async function runArmAJob(o: AblationOptions, job: AblationJob, sources: Sources, support: Support): Promise<ArmJobResult> {
  const client = o.client("A", job);
  const runs: ArmRun[] = [];
  let cut: ArmACut | undefined;
  const started = Date.now();
  for (const task of tasksOf(job)) {
    const r = await runArmA(client, sources, task, o.contextTokens);
    cut ??= r.cut;
    runs.push(r);
  }
  return {
    arm: "A",
    job: job.id,
    ...scoreRuns("A", job, runs, support),
    inputTokens: runs.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: runs.reduce((s, r) => s + r.outputTokens, 0),
    seconds: (Date.now() - started) / 1000,
    ...(cut ? { cut } : {}),
  };
}

/**
 * Arm B on one job: phase 1 builds the per-run database from the source tables and closes it; phase 2 opens it
 * locked for the tasks; the cited statements are re-run on a fresh locked open for citation validity. The per-run
 * folder (database and temp directory) is deleted afterwards, whatever happened.
 */
async function runArmBJob(o: AblationOptions, job: AblationJob, sources: Sources, support: Support): Promise<ArmJobResult> {
  const base = o.workDir ?? tmpdir();
  mkdirSync(base, { recursive: true });
  const runDir = mkdtempSync(join(base, `aa-ablation-b-${job.id}-`));
  const limits = o.limits ?? DEFAULT_LIMITS;
  const client = o.client("B", job);
  const runs: ArmRun[] = [];
  const started = Date.now();
  const rerun = new Map<string, readonly (readonly unknown[])[] | undefined>();
  try {
    const db = join(runDir, "source.duckdb");
    const tables = await buildSourceDatabase(db, sources.tables, sources.fileOf, limits);
    const documents = sources.documents.map((d) => d.file);
    const sandbox = await SqlSandbox.open(db, join(runDir, "tmp"), limits);
    try {
      for (const task of tasksOf(job)) runs.push(await runArmB(client, sandbox, tables, documents, task));
    } finally {
      sandbox.close();
    }
    // Citation validity: each statement an answer cites, re-run on a fresh locked open of the same file.
    const cited = new Set(
      runs.flatMap((r) => {
        const a = r.answer as QuestionAnswer | undefined;
        return a?.sql?.length ? a.sql.map((s) => s.trim()) : (r.queries ?? []).filter((q) => q.rows).map((q) => q.sql.trim());
      }),
    );
    if (cited.size) {
      const fresh = await SqlSandbox.open(db, join(runDir, "tmp-rerun"), limits);
      try {
        for (const sql of cited)
          rerun.set(
            sql,
            await fresh
              .run(sql)
              .then((r) => r.rows)
              .catch(() => undefined),
          );
      } finally {
        fresh.close();
      }
    }
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
  return {
    arm: "B",
    job: job.id,
    ...scoreRuns("B", job, runs, support, rerun),
    inputTokens: runs.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: runs.reduce((s, r) => s + r.outputTokens, 0),
    seconds: (Date.now() - started) / 1000,
    cleanedUp: !existsSync(runDir),
  };
}

function measuresOf(arm: Arm, results: readonly ArmJobResult[], o: AblationOptions): ArmMeasures {
  if (arm !== "A" && !o.tools)
    return {
      arm,
      ran: false,
      skipped: "the model can't call tools: arm A only (analyst-grade §4.5)",
      inputTokens: 0,
      outputTokens: 0,
      seconds: 0,
    };
  const mine = results.filter((r) => r.arm === arm);
  const sum = (f: (r: ArmJobResult) => number) => mine.reduce((s, r) => s + f(r), 0);
  const base = {
    arm,
    ran: true,
    inputTokens: sum((r) => r.inputTokens),
    outputTokens: sum((r) => r.outputTokens),
    seconds: sum((r) => r.seconds),
  };
  const golden = mine.flatMap((r) => r.golden ?? []);
  const changes = mine.flatMap((r) => (r.changes ? [r.changes] : []));
  const tasks = mine.flatMap((r) => r.tasks);
  const cuts = mine.flatMap((r) => (r.cut && !r.cut.complete ? [`${r.job}: ${r.cut.statement}`] : []));
  return {
    ...base,
    ...(o.suite === "golden" ? goldenMeasures(golden) : {}),
    ...(o.suite === "golden" && arm !== "C"
      ? {
          unsupported: {
            numbers: tasks.reduce((s, t) => s + (t.numbers?.claimed ?? 0), 0),
            unsupported: tasks.reduce((s, t) => s + (t.numbers?.unsupported ?? 0), 0),
            unsupportedWithoutCells: tasks.reduce((s, t) => s + (t.numbers?.unsupportedWithoutCells ?? 0), 0),
          },
        }
      : {}),
    ...(o.suite === "golden" && arm === "B"
      ? {
          citations: rate(tasks.filter((t) => t.citation === true).length, tasks.filter((t) => t.citation !== undefined).length),
        }
      : {}),
    ...(o.suite === "smoke" ? changesMeasures(changes) : {}),
    ...(cuts.length ? { cuts } : {}),
  };
}

/** C − A, C − B and B − A, paired by task (job and task id), each with its 95% bootstrap interval (10,000, fixed seed). */
function comparisons(arms: readonly Arm[], results: readonly ArmJobResult[]): Comparison[] {
  const scores = (arm: Arm) =>
    new Map(results.filter((r) => r.arm === arm).flatMap((r) => r.tasks.map((t) => [`${r.job}/${t.task}`, t.score])));
  const pairs: [Arm, Arm][] = [
    ["A", "C"],
    ["B", "C"],
    ["A", "B"],
  ];
  const out: Comparison[] = [];
  for (const [a, b] of pairs) {
    if (!arms.includes(a) || !arms.includes(b)) continue;
    const sa = scores(a);
    const sb = scores(b);
    const keys = [...sa.keys()].filter((k) => sb.has(k));
    if (!keys.length) continue;
    const difference = pairedBootstrap(
      keys.map((k) => sa.get(k) as number),
      keys.map((k) => sb.get(k) as number),
    );
    out.push({ pair: `${b} − ${a}`, tasks: keys.length, difference, adds: difference.low > 0 });
  }
  return out;
}
