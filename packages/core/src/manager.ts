// The in-process job runner every door uses (ARCHITECTURE §1, §6): jobs live in `<root>/<jobId>/`, run one at a
// time (concurrency 1 by default on CPU-only hosts), and stream their events to subscribers. The API, MCP server,
// CLI and Telegram bot are thin adapters over this class, so the same files give the same report through any door.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InputFile } from "@agentic-analytics/ingest";
import { describeMetric, type Grain, metricsYaml } from "@agentic-analytics/metrics";
import type { ModelClient } from "@agentic-analytics/models";
import type { JobEvent, MetricDef, Report, Stage } from "@agentic-analytics/schema";
import { sql, Workspace } from "@agentic-analytics/store";
import { type Answer, askJob, explainFact, type FactExplanation } from "./followup.ts";
import { confirmJobMetrics, type JobDeps, JobError, type JobOptions, runJob } from "./job.ts";

export class ManagerError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "BUSY" | "NOT_READY" | "BAD_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "ManagerError";
  }
}

export type JobState = "queued" | "running" | "awaiting_confirmation" | "done" | "failed";

export interface JobStatus {
  readonly job_id: string;
  readonly status: JobState;
  readonly stage?: Stage;
  /** Share of the pipeline's stages finished (0–100); a stage's own progress is in the events. */
  readonly progress: number;
  readonly created_at: string;
  readonly updated_at: string;
  /** Milliseconds per completed stage, by stage name. */
  readonly timings: Record<string, number>;
  readonly error?: { readonly code: string; readonly message: string; readonly stage?: Stage };
}

export interface ManagerOptions {
  /** Folder that holds one folder per job (default `data/jobs`). */
  readonly root: string;
  /** Models, embedder and web lane for a job (called when the job starts or resumes). */
  readonly deps: (options: JobOptions) => JobDeps;
  /** The model for follow-up questions (the planner and judge roles). */
  readonly model: ModelClient;
  /** Option defaults for every new job, whichever door creates it (e.g. small-model mode from the model profile). */
  readonly defaults?: Partial<JobOptions>;
  readonly now?: () => Date;
}

const STAGES: readonly Stage[] = [
  "INGEST",
  "PROFILE",
  "METRICS_DRAFT",
  "AWAIT_CONFIRM",
  "MEASURE",
  "DETECT",
  "DECOMPOSE",
  "INDEX_DOCS",
  "WEB_CONTEXT",
  "EXPLAIN",
  "DECIDE",
  "VERIFY",
  "RENDER",
];
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
const TERMINAL: readonly JobState[] = ["done", "failed", "awaiting_confirmation"];

export class JobManager {
  private readonly listeners = new Map<string, Set<(e: JobEvent) => void>>();
  private readonly waiters = new Map<string, Set<(s: JobStatus) => void>>();
  /** Events of jobs run by this process, kept so a late subscriber gets the history while the job holds its file. */
  private readonly live = new Map<string, JobEvent[]>();
  private readonly active = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private readonly now: () => Date;

  /** The folder holding one folder per job. */
  get root(): string {
    return this.opts.root;
  }

  constructor(private readonly opts: ManagerOptions) {
    this.now = opts.now ?? (() => new Date());
    mkdirSync(opts.root, { recursive: true });
  }

  private dir(id: string): string {
    if (!ID.test(id)) throw new ManagerError("NOT_FOUND", `no job ${id}`);
    const d = join(this.opts.root, id);
    if (!existsSync(d)) throw new ManagerError("NOT_FOUND", `no job ${id}`);
    return d;
  }

  private write(id: string, patch: Partial<JobStatus>): JobStatus {
    const path = join(this.opts.root, id, "status.json");
    const prev = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as JobStatus) : undefined;
    const at = this.now().toISOString();
    const next = {
      job_id: id,
      status: "queued",
      progress: 0,
      created_at: at,
      timings: {},
      ...prev,
      ...patch,
      updated_at: at,
    } as JobStatus;
    if (patch.status && patch.status !== "failed") delete (next as { error?: unknown }).error;
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
    if (TERMINAL.includes(next.status)) for (const w of this.waiters.get(id) ?? []) w(next);
    return next;
  }

  /** Starts a new job; it runs when the queue reaches it. */
  async create(files: readonly InputFile[], options: JobOptions, jobId?: string): Promise<JobStatus> {
    if (!files.length) throw new ManagerError("BAD_REQUEST", "a job needs at least one file");
    const stamp = this.now()
      .toISOString()
      .replace(/[-:.TZ]/g, "")
      .slice(0, 14);
    const id = jobId ?? `job-${stamp}-${crypto.randomUUID().slice(0, 6)}`;
    if (!ID.test(id)) throw new ManagerError("BAD_REQUEST", `invalid job id ${id}`);
    const dir = join(this.opts.root, id);
    if (existsSync(dir)) throw new ManagerError("BAD_REQUEST", `job ${id} exists`);
    mkdirSync(join(dir, "input"), { recursive: true });
    const used = new Set<string>();
    for (const [i, f] of files.entries()) {
      // File names come from uploads: keep the base name only, never "." or "..", and never overwrite another file.
      let name = f.name.split(/[\\/]/).pop() ?? "";
      if (!name || name === "." || name === "..") name = `file-${i + 1}`;
      const dot = name.lastIndexOf(".");
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem} (${n})${ext}`;
      used.add(name.toLowerCase());
      writeFileSync(join(dir, "input", name), f.bytes);
    }
    writeFileSync(join(dir, "options.json"), `${JSON.stringify({ ...this.opts.defaults, ...options }, null, 2)}\n`);
    const s = this.write(id, { status: "queued" });
    this.enqueue(id);
    return s;
  }

  /** `history`: events the job already has (a resumed job), so a late subscriber still sees its earlier stages. */
  private enqueue(id: string, history: JobEvent[] = []): void {
    this.active.add(id);
    this.live.set(id, this.live.get(id) ?? history);
    // execute never rejects, so one broken job can't stall the queue.
    this.queue = this.queue.then(() => this.execute(id));
  }

  private async execute(id: string): Promise<void> {
    const dir = join(this.opts.root, id);
    const timings: Record<string, number> = {};
    try {
      const options = JSON.parse(readFileSync(join(dir, "options.json"), "utf8")) as JobOptions;
      Object.assign(timings, this.readStatus(id)?.timings ?? {});
      this.write(id, { status: "running" });
      const deps = this.opts.deps(options);
      await runJob(
        { dir, jobId: id, options },
        {
          ...deps,
          onEvent: (e) => {
            deps.onEvent?.(e);
            this.live.get(id)?.push(e);
            if (e.type === "stage_started") this.write(id, { stage: e.stage });
            if (e.type === "stage_completed") {
              timings[e.stage] = e.duration_ms;
              this.write(id, { stage: e.stage, timings, progress: Math.round(((STAGES.indexOf(e.stage) + 1) / STAGES.length) * 100) });
            }
            for (const l of this.listeners.get(id) ?? []) l(e);
          },
        },
      );
      this.write(id, { status: "done", progress: 100, timings });
    } catch (err) {
      if (err instanceof JobError && err.code === "AWAITING_CONFIRMATION")
        this.write(id, { status: "awaiting_confirmation", stage: "AWAIT_CONFIRM" });
      else {
        // A stage failure carries the stage's own error as its cause (e.g. PROVIDER when no model answers).
        const cause = err instanceof Error && err.cause instanceof Error ? err.cause : undefined;
        const codeOf = (e: unknown) => (e instanceof Error && "code" in e && typeof e.code === "string" ? e.code : undefined);
        const code = codeOf(cause) ?? codeOf(err) ?? "FAILED";
        const stage = err instanceof Error && "stage" in err ? (err.stage as Stage | undefined) : undefined;
        const message = err instanceof Error ? err.message : String(err);
        try {
          this.write(id, { status: "failed", error: { code, message, ...(stage ? { stage } : {}) } });
        } catch {
          // The job folder is gone (deleted mid-run): nothing to record.
        }
      }
    } finally {
      this.active.delete(id);
      // The events are in the job's DuckDB file; keep memory for running jobs only.
      this.live.delete(id);
    }
  }

  private readStatus(id: string): JobStatus | undefined {
    const path = join(this.opts.root, id, "status.json");
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as JobStatus) : undefined;
  }

  async status(id: string): Promise<JobStatus> {
    this.dir(id);
    const s = this.readStatus(id);
    if (!s) throw new ManagerError("NOT_FOUND", `no job ${id}`);
    // A job this process didn't finish (the server restarted mid-run) is reported as failed: resume it.
    if ((s.status === "running" || s.status === "queued") && !this.active.has(id))
      return { ...s, status: "failed", error: { code: "INTERRUPTED", message: "the engine stopped while this job ran; resume it" } };
    return s;
  }

  /** Resolves when the job is done, failed or waiting for confirmation. */
  async wait(id: string): Promise<JobStatus> {
    // The waiter is registered before the status is read: a job that ends while the read is pending notifies it,
    // instead of finishing in the gap between the read and the registration and never resolving the wait.
    const set = this.waiters.get(id) ?? new Set();
    this.waiters.set(id, set);
    let once: (x: JobStatus) => void = () => {};
    const ended = new Promise<JobStatus>((resolve) => {
      once = (x: JobStatus) => {
        set.delete(once);
        resolve(x);
      };
      set.add(once);
    });
    const s = await this.status(id).catch((err: unknown) => {
      set.delete(once);
      throw err;
    });
    if (TERMINAL.includes(s.status)) {
      set.delete(once);
      return s;
    }
    return ended;
  }

  /** All events so far, then live ones; returns an unsubscribe function. */
  async subscribe(id: string, listener: (e: JobEvent) => void): Promise<() => void> {
    for (const e of await this.events(id)) listener(e);
    const set = this.listeners.get(id) ?? new Set();
    set.add(listener);
    this.listeners.set(id, set);
    return () => set.delete(listener);
  }

  async events(id: string): Promise<JobEvent[]> {
    const dir = this.dir(id);
    const mem = this.live.get(id);
    if (mem) return [...mem];
    if (!existsSync(join(dir, "job.duckdb"))) return [];
    return this.withWorkspace(id, async (ws) => {
      const rows = await ws.all<{ seq: number; type: string; at: string; payload: string }>(
        sql`SELECT seq, type, strftime(occurred_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS at, payload::VARCHAR AS payload
            FROM events WHERE job_id = ${id} ORDER BY seq`,
      );
      return rows.map((r) => ({ ...(JSON.parse(r.payload) as object), job_id: id, seq: r.seq, at: r.at, type: r.type }) as JobEvent);
    });
  }

  private async withWorkspace<T>(id: string, f: (ws: Workspace) => Promise<T>): Promise<T> {
    const dir = this.dir(id);
    if (this.active.has(id)) throw new ManagerError("BUSY", `job ${id} is running`);
    const ws = await Workspace.open(join(dir, "job.duckdb"));
    try {
      return await f(ws);
    } finally {
      ws.close();
    }
  }

  /** The drafted (or confirmed) metric definitions: YAML to edit, and each in plain words. */
  async metrics(id: string): Promise<{ yaml: string; metrics: { id: string; status: string; text: string }[] }> {
    return this.withWorkspace(id, async (ws) => {
      const rows = await ws.all<{ output: string | null; stage: string }>(
        sql`SELECT stage, output::VARCHAR AS output FROM job_stages WHERE stage IN ('METRICS_DRAFT', 'AWAIT_CONFIRM')`,
      );
      const parsed = new Map(
        rows.map((r) => [r.stage, JSON.parse(r.output ?? "null") as { defs?: MetricDef[]; range?: { grain: Grain } } | null]),
      );
      const drafted = parsed.get("METRICS_DRAFT");
      if (!drafted?.defs) throw new ManagerError("NOT_READY", "metrics are not drafted yet");
      const defs = parsed.get("AWAIT_CONFIRM")?.defs ?? drafted.defs;
      const grain = drafted.range?.grain ?? "month";
      return {
        yaml: metricsYaml(defs, { grain }),
        metrics: defs.map((d) => ({ id: d.id, status: d.status, text: describeMetric(d, defs, grain) })),
      };
    });
  }

  /** Stores confirmed definitions and resumes a job that waits at AWAIT_CONFIRM. */
  async confirm(id: string, yaml: string): Promise<JobStatus> {
    const dir = this.dir(id);
    if (this.active.has(id)) throw new ManagerError("BUSY", `job ${id} is running`);
    try {
      await confirmJobMetrics(dir, yaml);
    } catch (err) {
      if (err instanceof JobError) throw new ManagerError("BAD_REQUEST", err.message);
      throw err;
    }
    const history = await this.events(id);
    const s = this.write(id, { status: "queued" });
    this.enqueue(id, history);
    return s;
  }

  /** Continues a failed or interrupted job from its last completed stage. */
  async resume(id: string): Promise<JobStatus> {
    this.dir(id);
    if (this.active.has(id)) throw new ManagerError("BUSY", `job ${id} is running`);
    const history = await this.events(id);
    const s = this.write(id, { status: "queued" });
    this.enqueue(id, history);
    return s;
  }

  async report(id: string): Promise<Report> {
    const path = join(this.dir(id), "report.json");
    if (!existsSync(path)) throw new ManagerError("NOT_READY", `job ${id} has no report yet`);
    return JSON.parse(readFileSync(path, "utf8")) as Report;
  }

  async reportHtml(id: string): Promise<string> {
    const path = join(this.dir(id), "report.html");
    if (!existsSync(path)) throw new ManagerError("NOT_READY", `job ${id} has no report yet`);
    return readFileSync(path, "utf8");
  }

  async ask(id: string, question: string): Promise<Answer> {
    const dir = this.dir(id);
    if (this.active.has(id)) throw new ManagerError("BUSY", `job ${id} is running`);
    if (!existsSync(join(dir, "report.json"))) throw new ManagerError("NOT_READY", `job ${id} has no report yet`);
    return askJob(dir, question, this.opts.model);
  }

  async explain(id: string, factId: string): Promise<FactExplanation> {
    const dir = this.dir(id);
    if (this.active.has(id)) throw new ManagerError("BUSY", `job ${id} is running`);
    if (!existsSync(join(dir, "report.json"))) throw new ManagerError("NOT_READY", `job ${id} has no report yet`);
    try {
      return await explainFact(dir, factId);
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "UNKNOWN_FACT") throw new ManagerError("NOT_FOUND", err.message);
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    const dir = this.dir(id);
    if (this.active.has(id)) throw new ManagerError("BUSY", `job ${id} is running`);
    rmSync(dir, { recursive: true, force: true });
    this.live.delete(id);
  }

  async list(): Promise<JobStatus[]> {
    const ids = readdirSync(this.opts.root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && ID.test(d.name) && existsSync(join(this.opts.root, d.name, "status.json")))
      .map((d) => d.name)
      .sort();
    return Promise.all(ids.map((id) => this.status(id)));
  }
}
