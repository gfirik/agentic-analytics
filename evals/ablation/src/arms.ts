// Arms A and B (docs/specs/accuracy.md §8.1–§8.3): the same model as the engine, without it. Both have the same retry
// budget as each other: 2 retries on an invalid JSON answer or a tool error, after which the task is a miss.
import { estimateTokens, type ModelClient, ModelError, type ToolDef, schemaText as zodSchemaText } from "@agentic-analytics/models";
import { z } from "zod";
import { AblationError, SQL_ERROR_CODES } from "./errors.ts";
import {
  ARM_A_SYSTEM,
  ARM_B_SYSTEM,
  armAChanges,
  armAQuestion,
  armBChanges,
  armBQuestion,
  ChangesAnswer,
  fixJson,
  QuestionAnswer,
  schemaText,
} from "./prompts.ts";
import type { SqlResult, SqlSandbox, TableInfo } from "./sandbox.ts";
import { type ArmACut, armAText, type Sources } from "./sources.ts";

/** 2 retries on invalid JSON or a tool error, the same for every arm (m14.md item 6). */
export const RETRY_BUDGET = 2;
/** Tool-loop steps per attempt for arm B: room for a few queries and the answer. */
export const MAX_STEPS = 8;
/** Arm A keeps this many tokens of the context window free for the answer. */
export const OUTPUT_RESERVE = 1024;

export type Task =
  | { readonly kind: "question"; readonly id: string; readonly question: string }
  | { readonly kind: "changes"; readonly id: string; readonly period: { readonly from: string; readonly to: string } };

export type TaskAnswer = QuestionAnswer | ChangesAnswer;

export interface QueryRun {
  readonly sql: string;
  /** The rows the arm saw; absent when the statement failed. */
  readonly rows?: SqlResult["rows"];
  readonly error?: { readonly code: string; readonly message: string };
}

export interface ArmRun {
  readonly task: string;
  readonly answer?: TaskAnswer;
  /** Why there is no answer: the retry budget spent, or a model failure. */
  readonly error?: string;
  /** Arm B's retries used (tool errors and invalid replies). Arm A's happen inside generateObject and aren't counted. */
  readonly retries?: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly ms: number;
  /** Arm B: every statement it ran, in order. */
  readonly queries?: readonly QueryRun[];
}

const shapeOf = (t: Task) => (t.kind === "question" ? QuestionAnswer : ChangesAnswer);

/** Arm A's prompt for a task within the context window: the data text cut by whole rows, the cut stated in it. */
export function armAPrompt(sources: Sources, task: Task, contextTokens: number): { prompt: string; cut: ArmACut } {
  // The prompt without the data, with the longest cut statement it could carry, sizes the data's budget.
  const bare = (data: string, cut: string) =>
    task.kind === "question" ? armAQuestion(data, cut, task.question) : armAChanges(data, cut, task.period);
  const fixed =
    estimateTokens(ARM_A_SYSTEM) +
    estimateTokens(zodSchemaText(shapeOf(task))) +
    estimateTokens(bare("", "x".repeat(400 + 120 * sources.tables.length))) +
    OUTPUT_RESERVE;
  const { text, cut } = armAText(sources, contextTokens - fixed);
  return { prompt: bare(text, cut.statement), cut };
}

/**
 * Arm A: one structured call with the files as text. `generateObject` retries an invalid answer with the error fed
 * back, at most RETRY_BUDGET times; after that the task has no answer.
 */
export async function runArmA(
  client: ModelClient,
  sources: Sources,
  task: Task,
  contextTokens: number,
): Promise<ArmRun & { cut: ArmACut }> {
  const { prompt, cut } = armAPrompt(sources, task, contextTokens);
  const started = Date.now();
  try {
    const { object, usage } = await client.generateObject<TaskAnswer>({
      role: "planner",
      schema: shapeOf(task) as z.ZodType<TaskAnswer>,
      system: ARM_A_SYSTEM,
      prompt,
      maxRetries: RETRY_BUDGET,
    });
    return {
      task: task.id,
      answer: object,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ms: Date.now() - started,
      cut,
    };
  } catch (err) {
    if (!fromModel(err)) throw err;
    return { task: task.id, error: oneLine(err), inputTokens: 0, outputTokens: 0, ms: Date.now() - started, cut };
  }
}

/** The JSON object in a model's reply: the whole text, a fenced block, or the outermost braces. */
export function parseAnswer<T>(text: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  const candidates = [
    text.trim(),
    /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1]?.trim(),
    text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1),
  ];
  let error = "no JSON object in the reply";
  for (const c of candidates) {
    if (!c) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(c);
    } catch {
      continue;
    }
    const parsed = schema.safeParse(raw);
    if (parsed.success) return { ok: true, value: parsed.data };
    error = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  return { ok: false, error };
}

/**
 * Arm B: a tool loop with one tool, `run_sql`, on the locked sandbox, and no metric layer or verifier. A refused or
 * stopped statement comes back to the model as a typed tool error and uses one retry; so does a final reply that
 * isn't the JSON answer. With the budget spent, the next tool error stops the task (RETRY_BUDGET) and an invalid
 * reply is final: the task is a miss.
 */
export async function runArmB(
  client: ModelClient,
  sandbox: SqlSandbox,
  tables: readonly TableInfo[],
  documents: readonly string[],
  task: Task,
): Promise<ArmRun> {
  const schema = shapeOf(task) as z.ZodType<TaskAnswer>;
  const queries: QueryRun[] = [];
  let retries = 0;
  const run_sql: ToolDef<{ sql: string }, SqlResult | { error: { code: string; message: string } }> = {
    description:
      "Runs one read-only DuckDB SQL statement on the business's tables and returns its columns and rows (at most a few hundred rows).",
    inputSchema: z.object({ sql: z.string().min(1).max(8000) }),
    async execute({ sql }) {
      try {
        const r = await sandbox.run(sql);
        queries.push({ sql, rows: r.rows });
        return r;
      } catch (err) {
        if (!(err instanceof AblationError) || !SQL_ERROR_CODES.has(err.code)) throw err;
        queries.push({ sql, error: { code: err.code, message: err.message } });
        if (retries >= RETRY_BUDGET)
          throw new AblationError("RETRY_BUDGET", `a tool error after ${RETRY_BUDGET} retries: ${err.code}`, { cause: err });
        retries++;
        return { error: { code: err.code, message: err.message } };
      }
    },
  };
  const prompt =
    task.kind === "question"
      ? armBQuestion(schemaText(tables), documents, task.question)
      : armBChanges(schemaText(tables), documents, task.period);
  const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: prompt }];
  let inputTokens = 0;
  let outputTokens = 0;
  const started = Date.now();
  const done = (rest: { answer?: TaskAnswer; error?: string }): ArmRun => ({
    task: task.id,
    ...rest,
    retries,
    inputTokens,
    outputTokens,
    ms: Date.now() - started,
    queries,
  });
  for (;;) {
    let text: string;
    try {
      const { steps, usage } = await client.generateWithTools({
        role: "planner",
        system: ARM_B_SYSTEM,
        messages,
        tools: { run_sql: run_sql as ToolDef },
        maxSteps: MAX_STEPS,
      });
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      text = steps.at(-1)?.text ?? "";
    } catch (err) {
      if (err instanceof AblationError && err.code === "RETRY_BUDGET") return done({ error: err.message });
      if (!fromModel(err)) throw err;
      return done({ error: oneLine(err) });
    }
    const parsed = parseAnswer(text, schema);
    if (parsed.ok) return done({ answer: parsed.value });
    if (retries >= RETRY_BUDGET) return done({ error: `not the JSON answer after ${RETRY_BUDGET} retries: ${parsed.error}` });
    retries++;
    messages.push({ role: "assistant", content: text || "(no reply)" }, { role: "user", content: fixJson(parsed.error) });
  }
}

/** A model or provider failure (a ModelError, or one wrapped in `cause`): that task's miss, not a harness bug. */
export function fromModel(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) if (e instanceof ModelError) return true;
  return false;
}

const oneLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0]?.slice(0, 200) ?? "";
