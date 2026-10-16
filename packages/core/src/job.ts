// One analytics job, end to end (ARCHITECTURE §2): INGEST → PROFILE → METRICS_DRAFT → (AWAIT_CONFIRM) →
// MEASURE → DETECT → DECOMPOSE → INDEX_DOCS → (WEB_CONTEXT) → EXPLAIN → DECIDE → VERIFY → RENDER, in a job folder
// with its own DuckDB file. Inputs are copied into the folder, so a killed job resumes with nothing but the folder:
// completed stages are skipped, the interrupted one is reset and re-run. The model is used only by METRICS_DRAFT
// (optional), EXPLAIN and DECIDE; everything numeric is deterministic code.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Budget,
  buildDraft,
  buildFactSheet,
  buildTools,
  data,
  decide,
  type ExplainResult,
  explainFindings,
  type OpenQuestionDraft,
  privateTerms,
  quarantinedSources,
  readExtracts,
  screenWorkspace,
  type ToolContext,
  writeHeadline,
} from "@agentic-analytics/agent";
import { analyzeJob, loadAnalysis, readFacts, type StoredInsight } from "@agentic-analytics/analysis";
import { type IngestResult, type InputFile, ingest } from "@agentic-analytics/ingest";
import { draftMetrics, type Grain, loadCatalog, saveMetricDefs } from "@agentic-analytics/metrics";
import type { ModelClient } from "@agentic-analytics/models";
import { type ProfileSummary, periodOf, profileJob } from "@agentic-analytics/profile";
import { type Embedder, indexDocuments, type Reranker } from "@agentic-analytics/retrieval";
import { type JobEvent, type MetricDef, type Recommendation, type Report, validateReport } from "@agentic-analytics/schema";
import { sql, Workspace } from "@agentic-analytics/store";
import type { FetchedPage, SearchProvider } from "@agentic-analytics/web";
import { EventBus } from "./events.ts";
import { type Logger, silentLogger } from "./log.ts";
import { type RunResult, runPipeline, type StageDef } from "./pipeline.ts";

export class JobError extends Error {
  constructor(
    readonly code: "NO_INPUT" | "INVALID_DRAFT" | "BAD_OPTIONS",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "JobError";
  }
}

export interface JobOptions {
  /** Today's date (ISO) for profiling rules like future dates; stored with the job. */
  readonly today: string;
  readonly currency?: string;
  readonly objective?: string;
  /** Small-model mode (agent-and-verifier §8): halved budgets, ≤ 3 findings, ≤ 2 recommendations, form-filling. */
  readonly smallModel?: boolean;
  /** The web lane (off by default; built in M8). */
  readonly web?: boolean;
  /** Tool calls per job and per finding (default 25 and 8; halved in small-model mode). */
  readonly budget?: { readonly total?: number; readonly perFinding?: number };
}

export interface JobDeps {
  readonly model: ModelClient;
  readonly embedder: Embedder;
  readonly reranker?: Reranker;
  readonly log?: Logger;
  readonly engine?: Report["engine"];
  readonly now?: () => Date;
  /** The web lane's search provider (and optionally the page fetcher); used only when the job has `web: true`. */
  readonly web?: { readonly provider: SearchProvider; readonly fetchPage?: (url: string) => Promise<FetchedPage> };
  /** Called with every job event as it is emitted (live views, SSE). */
  readonly onEvent?: (e: JobEvent) => void;
}

export interface RunJobInput {
  /** The job folder; created if missing. Re-running with the same folder resumes the job. */
  readonly dir: string;
  readonly jobId?: string;
  /** Files for a new job; omitted on resume (they are read back from `<dir>/input`). */
  readonly files?: readonly InputFile[];
  /** Options for a new job; on resume the stored options are used. */
  readonly options?: JobOptions;
}

export interface JobOutcome {
  readonly jobId: string;
  readonly draftPath: string;
  readonly report: Report;
  readonly run: RunResult;
}

const DB = "job.duckdb";

function readInputs(dir: string): InputFile[] {
  const inputDir = join(dir, "input");
  if (!existsSync(inputDir)) return [];
  return readdirSync(inputDir)
    .sort()
    .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(inputDir, name))) }));
}

async function meta<T>(ws: Workspace, key: string): Promise<T | undefined> {
  const r = await ws.one<{ value: string }>(sql`SELECT value::VARCHAR AS value FROM job_meta WHERE key = ${key}`);
  return r ? (JSON.parse(r.value) as T) : undefined;
}

async function setMeta(ws: Workspace, key: string, value: unknown): Promise<void> {
  await ws.run(sql`INSERT OR REPLACE INTO job_meta VALUES (${key}, ${JSON.stringify(value)}::JSON)`);
}

async function profileDone(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  const ws = await Workspace.open(path);
  try {
    const r = await ws.one<{ n: number }>(sql`SELECT count(*) AS n FROM job_stages WHERE stage = 'PROFILE' AND status = 'completed'`);
    return (r?.n ?? 0) > 0;
  } finally {
    ws.close();
  }
}

interface MetricsOutput {
  readonly defs: MetricDef[];
  readonly range: { from: string; to: string; grain: Grain };
  readonly periodEnd: string;
  readonly source: string;
}

interface MeasureOutput {
  readonly top: string[];
  readonly openQuestions: string[];
}

interface ExplainOutputStored extends ExplainResult {
  readonly questions: OpenQuestionDraft[];
  readonly quarantined: string[];
  /** Queries sent to the search provider, as sent (sanitized): the audit trail of what left the machine. */
  readonly webQueries: string[];
  readonly toolCalls: number;
}

export async function runJob(input: RunJobInput, deps: JobDeps): Promise<JobOutcome> {
  const { dir } = input;
  mkdirSync(join(dir, "input"), { recursive: true });
  const path = join(dir, DB);
  // A job that never finished PROFILE has nothing worth keeping: start its workspace from scratch.
  if (existsSync(path) && !(await profileDone(path))) {
    rmSync(path, { force: true });
    rmSync(`${path}.wal`, { force: true });
  }
  const ws = await Workspace.open(path);
  try {
    let options = await meta<JobOptions>(ws, "options");
    let jobId = await meta<string>(ws, "job_id");
    if (!options) {
      if (!input.options) throw new JobError("BAD_OPTIONS", "a new job needs options (at least `today`)");
      if (!input.files?.length && !readInputs(dir).length) throw new JobError("NO_INPUT", "a new job needs input files");
      for (const f of input.files ?? []) writeFileSync(join(dir, "input", f.name), f.bytes);
      options = input.options;
      jobId =
        input.jobId ??
        `job-${(deps.now ?? (() => new Date()))()
          .toISOString()
          .replace(/[-:.TZ]/g, "")
          .slice(0, 14)}`;
      await setMeta(ws, "options", options);
      await setMeta(ws, "job_id", jobId);
    }
    const opts = options;
    const id = jobId as string;
    const log = (deps.log ?? silentLogger).child({ job: id });
    const bus = await EventBus.open(ws, id, deps.now);
    if (deps.onEvent) bus.subscribe(deps.onEvent);
    const small = opts.smallModel === true;
    const total = opts.budget?.total ?? 25;
    const perFinding = opts.budget?.perFinding ?? 8;
    const budget = new Budget(small ? Math.floor(total / 2) : total, small ? Math.floor(perFinding / 2) : perFinding);
    let ingested: IngestResult | undefined;

    const stages: StageDef[] = [
      {
        stage: "INGEST",
        run: async () => {
          ingested = await ingest(readInputs(dir));
          return {
            files: ingested.files.length,
            tables: ingested.tables.length,
            sections: ingested.documents.length,
            issues: ingested.issues.length,
          };
        },
      },
      {
        stage: "PROFILE",
        run: async () => {
          const summary = await profileJob(ws, ingested ?? (await ingest(readInputs(dir))), { today: opts.today });
          return summary;
        },
      },
      {
        stage: "METRICS_DRAFT",
        reset: async (w) => {
          await w.run(sql`DELETE FROM metric_defs`);
        },
        run: async (ctx) => {
          const summary = (await ctx.output<ProfileSummary>("PROFILE")) as ProfileSummary;
          const catalog = await loadCatalog(ws);
          const draft = await draftMetrics(summary, catalog, {
            ...(opts.currency ? { defaultCurrency: opts.currency } : {}),
            model: deps.model,
          });
          const grain = summary.grain as Grain;
          const bounds = summary.tables.flatMap((t) => (t.date_first && t.date_last ? [t.date_first, t.date_last] : [])).sort();
          const periods = bounds.map((d) => periodOf(d, grain)).sort();
          const range = { from: periods[0] ?? "0000", to: periods.at(-1) ?? "9999", grain };
          // --yes semantics (interactive review lands with the CLI in M10): drafts are kept as assumptions.
          const defs = draft.validation.accepted.map((d) => ({ ...d, status: "assumed" as const }));
          await saveMetricDefs(ws, defs, catalog, range);
          ctx.log.info("metrics drafted", { source: draft.source, accepted: defs.length, rejected: draft.validation.rejected.length });
          return { defs, range, periodEnd: bounds.at(-1) ?? opts.today, source: draft.source } satisfies MetricsOutput;
        },
      },
      { stage: "AWAIT_CONFIRM", skip: () => "metrics kept as assumptions (non-interactive run)", run: async () => null },
      {
        stage: "MEASURE",
        reset: async (w) => {
          await w.run(sql`DELETE FROM insights`);
          await w.run(sql`DELETE FROM decompositions`);
        },
        run: async (ctx) => {
          const m = (await ctx.output<MetricsOutput>("METRICS_DRAFT")) as MetricsOutput;
          // analyzeJob measures, detects and decomposes in one deterministic pass and stores the results; the
          // DETECT and DECOMPOSE stages below checkpoint and report what it stored.
          const r = await analyzeJob(ws, m.defs, await loadCatalog(ws), m.range);
          return { top: r.top, openQuestions: r.openQuestions } satisfies MeasureOutput;
        },
      },
      {
        stage: "DETECT",
        run: async () => {
          const a = await loadAnalysis(ws);
          return { insights: a.insights.length, material: a.insights.filter((i) => i.material).length };
        },
      },
      {
        stage: "DECOMPOSE",
        run: async () => {
          const a = await loadAnalysis(ws);
          return { decompositions: a.decompositions.length };
        },
      },
      {
        stage: "INDEX_DOCS",
        reset: async (w) => {
          await w.run(sql`DELETE FROM quarantine`);
        },
        run: async (ctx) => {
          // Screen every untrusted source before any model can read it (security §3).
          const screened = await screenWorkspace(ws);
          if (screened.quarantined.length)
            await ctx.bus.emit({
              type: "warning",
              stage: "INDEX_DOCS",
              code: "QUARANTINED",
              message: `${screened.quarantined.length} source(s) quarantined for text addressed to a model`,
            });
          return { ...(await indexDocuments(ws, deps.embedder)), quarantined: screened.quarantined };
        },
      },
      {
        stage: "WEB_CONTEXT",
        skip: () =>
          !opts.web ? "web lane off (enable with --web)" : !deps.web ? "web lane on, but no search provider is configured" : undefined,
        run: async (ctx) => {
          // What must never leave the machine; the planner's web searches are sanitized against it in EXPLAIN.
          const terms = await privateTerms(ws);
          ctx.log.info("web lane ready", {
            provider: deps.web?.provider.id,
            private_names: terms.names.length,
            private_values: terms.values?.length ?? 0,
          });
          return { provider: deps.web?.provider.id, private_names: terms.names.length, private_values: terms.values?.length ?? 0 };
        },
      },
      {
        stage: "EXPLAIN",
        reset: async (w) => {
          await w.run(sql`DELETE FROM extracts`);
          await w.run(sql`DELETE FROM web_results`);
          await w.run(sql`DELETE FROM sources WHERE kind = 'web'`);
          // Quarantine rows EXPLAIN created (extractor flags, web pages); INDEX_DOCS' screen rows stay.
          await w.run(sql`DELETE FROM quarantine WHERE detected_by = 'extractor' OR source_id LIKE 'W%'`);
        },
        run: async (ctx) => {
          const m = (await ctx.output<MetricsOutput>("METRICS_DRAFT")) as MetricsOutput;
          const measured = (await ctx.output<MeasureOutput>("MEASURE")) as MeasureOutput;
          const analysis = await loadAnalysis(ws);
          const catalog = await loadCatalog(ws);
          const factMap = async () => new Map((await readFacts(ws)).map((f) => [f.id, f]));
          const facts = await factMap();
          const quality = await ws.all<{ id: string; kind: string; severity: string }>(
            sql`SELECT id, kind, severity FROM quality_issues ORDER BY id`,
          );
          const ranked = measured.top
            .map((i) => analysis.insights.find((x) => x.id === i))
            .filter((x): x is StoredInsight => x !== undefined);
          // Changes of a whole metric come before changes of one member (a customer, a product): they are what the
          // headline is about, and a rate tripling must not lose its slot to one customer's good month.
          const top = [...ranked.filter((i) => !i.member), ...ranked.filter((i) => i.member)];
          const sheet = buildFactSheet({
            objective: objectiveText(opts),
            period: m.range,
            defs: m.defs,
            insights: analysis.insights,
            decompositions: analysis.decompositions,
            facts,
            quality,
            only: measured.top,
          });
          const toolCtx: ToolContext = {
            ws,
            defs: m.defs,
            catalog,
            range: m.range,
            insights: analysis.insights,
            decompositions: analysis.decompositions,
            model: deps.model,
            embedder: deps.embedder,
            ...(deps.reranker ? { reranker: deps.reranker } : {}),
            ...(opts.web && deps.web
              ? {
                  webLane: {
                    provider: deps.web.provider,
                    ...(deps.web.fetchPage ? { fetchPage: deps.web.fetchPage } : {}),
                    terms: await privateTerms(ws),
                  },
                }
              : {}),
            found: { extracts: [], quarantined: [], questions: [], scenarios: [] },
          };
          if (opts.web && !deps.web)
            // The job asked for the web lane but this run has no search provider (e.g. resumed without --web).
            await ctx.bus.emit({
              type: "warning",
              stage: "EXPLAIN",
              code: "WEB_UNAVAILABLE",
              message: "the job has web on, but no search provider is configured for this run",
            });
          const tools = buildTools(toolCtx, budget);
          const r = await explainFindings(toolCtx, tools, budget, deps.model, top, analysis.decompositions, sheet, factMap, {
            small,
            maxFindings: small ? 3 : 5,
            log: ctx.log,
            onFinding: (done, total) => ctx.progress(Math.round((done / total) * 100), `finding ${done} of ${total} explained`),
          });
          return {
            ...r,
            questions: toolCtx.found.questions,
            quarantined: toolCtx.found.quarantined,
            webQueries: toolCtx.found.webQueries ?? [],
            toolCalls: budget.used,
          } satisfies ExplainOutputStored;
        },
      },
      {
        stage: "DECIDE",
        run: async (ctx) => {
          const m = (await ctx.output<MetricsOutput>("METRICS_DRAFT")) as MetricsOutput;
          const measured = (await ctx.output<MeasureOutput>("MEASURE")) as MeasureOutput;
          const ex = (await ctx.output<ExplainOutputStored>("EXPLAIN")) as ExplainOutputStored;
          const analysis = await loadAnalysis(ws);
          const factMap = async () => new Map((await readFacts(ws)).map((f) => [f.id, f]));
          const sheet = buildFactSheet({
            objective: objectiveText(opts),
            period: m.range,
            defs: m.defs,
            insights: analysis.insights,
            decompositions: analysis.decompositions,
            facts: await factMap(),
            quality: [],
            only: Object.values(ex.insightOf),
          });
          const d = await decide({
            ws,
            defs: m.defs,
            catalog: await loadCatalog(ws),
            grain: m.range.grain,
            model: deps.model,
            objective: objectiveText(opts),
            findings: ex.findings,
            factsheet: data(sheet),
            facts: factMap,
            extracts: await readExtracts(ws),
            periodEnd: m.periodEnd,
            maxRecommendations: small ? 2 : 5,
          });
          const headline = await writeHeadline(deps.model, ex.findings, small);
          const report = await buildDraft(ws, {
            jobId: id,
            generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
            engine: deps.engine ?? { version: "0.0.0", models: [] },
            period: m.range,
            objective: { text: objectiveText(opts), source: opts.objective ? "user" : "default" },
            defs: m.defs,
            headline,
            findings: ex.findings,
            recommendations: d.recommendations as Recommendation[],
            analysisQuestions: measured.openQuestions,
            askedQuestions: ex.questions,
            quarantined: await quarantinedSources(ws),
            dropped: [...ex.dropped, ...d.dropped],
            downgraded: ex.downgraded,
            facts: await factMap(),
          });
          const v = validateReport(report);
          if (!v.ok)
            throw new JobError(
              "INVALID_DRAFT",
              `the draft report breaks the schema: ${v.issues
                .slice(0, 5)
                .map((i) => `${i.path} ${i.message}`)
                .join("; ")}`,
              v.issues,
            );
          writeFileSync(join(dir, "report.draft.json"), `${JSON.stringify(report, null, 2)}\n`);
          return { findings: report.findings.length, recommendations: report.recommendations.length, facts: report.facts.length };
        },
      },
      { stage: "VERIFY", skip: () => "the verifier is built in M9", run: async () => null },
      { stage: "RENDER", skip: () => "the final renderer is built in M10", run: async () => null },
    ];

    const run = await runPipeline(ws, bus, log, stages);
    await bus.emit({ type: "done", report_path: join(dir, "report.draft.json") });
    const report = JSON.parse(readFileSync(join(dir, "report.draft.json"), "utf8")) as Report;
    return { jobId: id, draftPath: join(dir, "report.draft.json"), report, run };
  } finally {
    ws.close();
  }
}

function objectiveText(o: JobOptions): string {
  return o.objective ?? "Grow profit: find what changed, why, and what to do next.";
}
