// The pipeline state machine (ARCHITECTURE §2): stages run in a fixed order, each checkpointed in the job's
// DuckDB file. A completed stage is never re-run; a stage that was interrupted (process killed, error) is reset
// and run again: its partial facts are deleted and its own `reset` removes the rest. So a crashed job resumes
// from the last completed stage, with the same results as an uninterrupted run.
import type { Stage } from "@agentic-analytics/schema";
import { sql, type Workspace } from "@agentic-analytics/store";
import type { EventBus } from "./events.ts";
import type { Logger } from "./log.ts";

export class PipelineError extends Error {
  constructor(
    readonly code: "STAGE_FAILED" | "BAD_ORDER",
    readonly stage: Stage | undefined,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PipelineError";
  }
}

/**
 * Thrown by a stage that must wait for a person (AWAIT_CONFIRM). It is not a failure: no `failed` event is emitted
 * and the stage stays `running`, so the next run of the job resets it and asks again (or goes on, once answered).
 */
export class StagePause extends Error {
  constructor(
    readonly stage: Stage,
    message: string,
  ) {
    super(message);
    this.name = "StagePause";
  }
}

export interface StageContext {
  readonly ws: Workspace;
  readonly bus: EventBus;
  readonly log: Logger;
  /** The JSON output a completed earlier stage stored. */
  output<T>(stage: Stage): Promise<T | undefined>;
  progress(pct: number, message?: string): Promise<void>;
}

export interface StageDef {
  readonly stage: Stage;
  /** Returns a reason to skip the stage (it is recorded, not run), or undefined to run it. */
  readonly skip?: () => string | undefined;
  /** Removes what an interrupted run of this stage left behind, beyond its facts (deleted by the runner). */
  readonly reset?: (ws: Workspace) => Promise<void>;
  /** Does the work; the returned value is stored as the stage output (keep it small: JSON). */
  readonly run: (ctx: StageContext) => Promise<unknown>;
}

export type StageStatus = "running" | "completed" | "failed" | "skipped";

export interface StageRecord {
  readonly stage: Stage;
  readonly status: StageStatus;
  readonly first_fact: number | null;
}

export async function stageRecords(ws: Workspace): Promise<StageRecord[]> {
  return ws.all<StageRecord & Record<string, unknown>>(sql`SELECT stage, status, first_fact FROM job_stages`);
}

async function stageOutput<T>(ws: Workspace, stage: Stage): Promise<T | undefined> {
  const r = await ws.one<{ output: string | null }>(sql`SELECT output::VARCHAR AS output FROM job_stages WHERE stage = ${stage}`);
  return r?.output ? (JSON.parse(r.output) as T) : undefined;
}

async function nextFact(ws: Workspace): Promise<number> {
  const r = await ws.one<{ n: number | null }>(sql`SELECT max(CAST(substr(id, 2) AS INTEGER)) AS n FROM facts`);
  return (r?.n ?? 0) + 1;
}

export interface RunResult {
  /** Stages run in this call (resumed jobs skip the completed ones). */
  readonly ran: Stage[];
  readonly resumed: Stage[];
  readonly skipped: Stage[];
}

export async function runPipeline(ws: Workspace, bus: EventBus, log: Logger, stages: readonly StageDef[]): Promise<RunResult> {
  const seen = new Set<Stage>();
  for (const s of stages) {
    if (seen.has(s.stage)) throw new PipelineError("BAD_ORDER", s.stage, `stage ${s.stage} appears twice`);
    seen.add(s.stage);
  }
  const records = new Map((await stageRecords(ws)).map((r) => [r.stage, r]));
  const result: RunResult = { ran: [], resumed: [], skipped: [] };
  for (const def of stages) {
    const prev = records.get(def.stage);
    if (prev?.status === "completed") continue;
    // A skipped stage is looked at again on every run: once its reason is gone (e.g. metrics now await confirmation, or
    // the web lane is on), it runs.
    if (prev?.status === "skipped" && def.skip?.()) continue;
    const ctx: StageContext = {
      ws,
      bus,
      log: log.child({ stage: def.stage }),
      output: (stage) => stageOutput(ws, stage),
      progress: async (pct, message) => {
        await bus.emit({ type: "progress", stage: def.stage, pct, ...(message ? { message } : {}) });
      },
    };
    const reason = def.skip?.();
    if (reason) {
      await ws.run(
        sql`INSERT OR REPLACE INTO job_stages (stage, status, output) VALUES (${def.stage}, 'skipped', ${JSON.stringify({ reason })}::JSON)`,
      );
      result.skipped.push(def.stage);
      ctx.log.info("stage skipped", { reason });
      continue;
    }
    if (prev && prev.status !== "skipped") {
      // Interrupted or failed earlier: undo its partial work before running it again.
      if (prev.first_fact !== null) await ws.run(sql`DELETE FROM facts WHERE CAST(substr(id, 2) AS INTEGER) >= ${prev.first_fact}`);
      await def.reset?.(ws);
      result.resumed.push(def.stage);
      ctx.log.info("stage resumed", { previous: prev.status });
    }
    const first = await nextFact(ws);
    await ws.run(
      sql`INSERT OR REPLACE INTO job_stages (stage, status, started_at, first_fact) VALUES (${def.stage}, 'running', now()::TIMESTAMP, ${first})`,
    );
    await bus.emit({ type: "stage_started", stage: def.stage });
    const t0 = Date.now();
    try {
      const output = await def.run(ctx);
      await ws.run(
        sql`UPDATE job_stages SET status = 'completed', completed_at = now()::TIMESTAMP, output = ${JSON.stringify(output ?? null)}::JSON
            WHERE stage = ${def.stage}`,
      );
      await bus.emit({ type: "stage_completed", stage: def.stage, duration_ms: Date.now() - t0 });
      result.ran.push(def.stage);
    } catch (err) {
      if (err instanceof StagePause) {
        ctx.log.info("stage paused", { reason: err.message });
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof Error && "code" in err && typeof err.code === "string" ? err.code : "STAGE_FAILED";
      await ws.run(sql`UPDATE job_stages SET status = 'failed' WHERE stage = ${def.stage}`);
      await bus.emit({ type: "failed", stage: def.stage, error: { code, message } });
      ctx.log.error("stage failed", { code, message });
      throw new PipelineError("STAGE_FAILED", def.stage, `${def.stage} failed: ${message}`, { cause: err });
    }
  }
  return result;
}
