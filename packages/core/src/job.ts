// One analytics job, end to end (ARCHITECTURE §2): INGEST → PROFILE → METRICS_DRAFT → (AWAIT_CONFIRM) →
// MEASURE → DETECT → DECOMPOSE → INDEX_DOCS → (WEB_CONTEXT) → EXPLAIN → DECIDE → VERIFY → RENDER, in a job folder
// with its own DuckDB file. Inputs are copied into the folder, so a killed job resumes with nothing but the folder:
// completed stages are skipped, the interrupted one is reset and re-run. The model is used only by METRICS_DRAFT
// (optional), EXPLAIN and DECIDE; everything numeric is deterministic code.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  Budget,
  buildDraft,
  buildEvidence,
  buildFactSheet,
  buildTools,
  decide,
  type ExplainResult,
  explainFindings,
  type OpenQuestionDraft,
  privateTerms,
  quarantinedSources,
  readExtracts,
  SMALL_MODEL_INPUT_BUDGET,
  screen,
  screenDocuments,
  screenTables,
  type ToolContext,
  writeHeadline,
} from "@agentic-analytics/agent";
import { analyzeJob, loadAnalysis, readFacts, type StoredInsight } from "@agentic-analytics/analysis";
import { type IngestResult, type InputFile, ingest } from "@agentic-analytics/ingest";
import {
  draftMetrics,
  draftRecord,
  type Grain,
  loadCatalog,
  parseMetricsYaml,
  saveMetricDefs,
  validateMetrics,
} from "@agentic-analytics/metrics";
import type { ModelClient } from "@agentic-analytics/models";
import { type ProfileSummary, partialLastMonth, periodOf, previousMonth, profileJob } from "@agentic-analytics/profile";
import { renderReportHtml } from "@agentic-analytics/report";
import { type Embedder, indexDocuments, type Reranker } from "@agentic-analytics/retrieval";
import { type JobEvent, type MetricDef, type Recommendation, type Report, validateReport } from "@agentic-analytics/schema";
import { sql, Workspace } from "@agentic-analytics/store";
import { persistChecks, VerifyError, verifyReport } from "@agentic-analytics/verify";
import type { FetchedPage, SearchProvider } from "@agentic-analytics/web";
import { EventBus } from "./events.ts";
import { type Logger, silentLogger } from "./log.ts";
import { type RunResult, runPipeline, type StageContext, type StageDef, StagePause } from "./pipeline.ts";

export class JobError extends Error {
  constructor(
    readonly code: "NO_INPUT" | "BAD_INPUT" | "INVALID_DRAFT" | "BAD_OPTIONS" | "AWAITING_CONFIRMATION" | "BAD_METRICS",
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
  /**
   * Keep drafted metrics as assumptions and go on (default true). When false the job pauses at AWAIT_CONFIRM until
   * `confirmJobMetrics` stores the confirmed definitions (metric-layer §3, interfaces §1).
   */
  readonly autoConfirm?: boolean;
  /**
   * Tool calls per job and per finding (default 25 and 8; halved in small-model mode), and small-model mode's input
   * budget for the DECIDE request in estimated tokens (default SMALL_MODEL_INPUT_BUDGET, 6,500; agent-and-verifier §8.1).
   */
  readonly budget?: { readonly total?: number; readonly perFinding?: number; readonly inputTokens?: number };
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
  /** The verified report (report.json). */
  readonly reportPath: string;
  /** The rendered report (report.html). */
  readonly htmlPath: string;
  readonly report: Report;
  /** The unverified draft (report.draft.json), as EXPLAIN/DECIDE wrote it. */
  readonly draft: Report;
  readonly run: RunResult;
}

const DB = "job.duckdb";
/** Every draft of the job's metrics before validation, with the validation result (accepted, rejected with reasons). */
export const DRAFTED_METRICS = "metrics.drafted.json";

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

/** Whether PROFILE completed, and the job's own settings, which outlive a restart from scratch. */
interface PriorRun {
  readonly profiled: boolean;
  readonly options?: JobOptions;
  readonly jobId?: string;
  /** The event history, so a restart continues its sequence numbers instead of repeating them. */
  readonly events: readonly { seq: number; job_id: string; occurred_at: string; type: string; payload: string | null }[];
}

async function priorRun(path: string): Promise<PriorRun> {
  const ws = await Workspace.open(path);
  try {
    const r = await ws.one<{ n: number }>(sql`SELECT count(*) AS n FROM job_stages WHERE stage = 'PROFILE' AND status = 'completed'`);
    const options = await meta<JobOptions>(ws, "options");
    const jobId = await meta<string>(ws, "job_id");
    const events = await ws.all<PriorRun["events"][number]>(
      sql`SELECT seq, job_id, occurred_at::VARCHAR AS occurred_at, type, payload::VARCHAR AS payload FROM events ORDER BY seq`,
    );
    return { profiled: (r?.n ?? 0) > 0, ...(options ? { options } : {}), ...(jobId ? { jobId } : {}), events };
  } finally {
    ws.close();
  }
}

interface MetricsOutput {
  readonly defs: MetricDef[];
  readonly range: { from: string; to: string; grain: Grain };
  readonly periodEnd: string;
  readonly source: string;
  /** The incomplete last month left out of the range, if any. */
  readonly partialPeriod?: string;
}

/** The definitions later stages use: the confirmed ones when the job paused for review, else the drafted ones. */
async function metricsOf(ctx: StageContext): Promise<MetricsOutput> {
  const drafted = (await ctx.output<MetricsOutput>("METRICS_DRAFT")) as MetricsOutput;
  const confirmed = await ctx.output<{ defs: MetricDef[] } | null>("AWAIT_CONFIRM");
  return confirmed?.defs ? { ...drafted, defs: confirmed.defs } : drafted;
}

/**
 * Stores reviewed metric definitions (YAML, the same file format as `aa metrics --save`) for a job paused at
 * AWAIT_CONFIRM. Each definition is validated against the job's catalog; one that fails is refused with its reasons,
 * so a confirmation can never put an invalid definition into a report. Definitions sent are `confirmed`.
 */
export async function confirmJobMetrics(dir: string, yaml: string): Promise<{ confirmed: number }> {
  const ws = await Workspace.open(join(dir, DB));
  try {
    const st = await ws.one<{ status: string }>(sql`SELECT status FROM job_stages WHERE stage = 'AWAIT_CONFIRM'`);
    if (st?.status !== "running") throw new JobError("BAD_METRICS", "the job is not waiting for metric confirmation");
    let file: ReturnType<typeof parseMetricsYaml>;
    try {
      file = parseMetricsYaml(yaml);
    } catch (err) {
      throw new JobError("BAD_METRICS", `the metrics YAML does not parse: ${err instanceof Error ? err.message : String(err)}`);
    }
    const options = (await meta<JobOptions>(ws, "options")) as JobOptions;
    const v = validateMetrics(
      file.metrics.map((m) => ({ ...m, status: "confirmed" })),
      await loadCatalog(ws),
      { ...(options.currency ? { defaultCurrency: options.currency } : {}), keepStatus: true },
    );
    if (v.rejected.length)
      throw new JobError(
        "BAD_METRICS",
        `rejected: ${v.rejected.map((r) => `${r.id ?? "(no id)"}: ${r.reasons.join("; ")}`).join(" | ")}`,
        v.rejected,
      );
    if (!v.accepted.length) throw new JobError("BAD_METRICS", "no metric definitions given");
    await setMeta(ws, "confirmed_metrics", v.accepted);
    return { confirmed: v.accepted.length };
  } finally {
    ws.close();
  }
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
  // A job that never finished PROFILE has no data worth keeping: start its workspace from scratch. Its options and id
  // are kept, so the resume command printed after the failure still works (the inputs stay in input/).
  const prior = existsSync(path) ? await priorRun(path) : undefined;
  if (prior && !prior.profiled) {
    rmSync(path, { force: true });
    rmSync(`${path}.wal`, { force: true });
  }
  const ws = await Workspace.open(path);
  try {
    if (prior && !prior.profiled) {
      if (prior.options) await setMeta(ws, "options", prior.options);
      if (prior.jobId) await setMeta(ws, "job_id", prior.jobId);
      for (const e of prior.events)
        await ws.run(sql`INSERT INTO events VALUES (${e.seq}, ${e.job_id}, ${e.occurred_at}::TIMESTAMP, ${e.type}, ${e.payload}::JSON)`);
    }
    let options = await meta<JobOptions>(ws, "options");
    let jobId = await meta<string>(ws, "job_id");
    if (!options) {
      if (!input.options) throw new JobError("BAD_OPTIONS", "a new job needs options (at least `today`)");
      if (!input.files?.length && !readInputs(dir).length) throw new JobError("NO_INPUT", "a new job needs input files");
      for (const f of input.files ?? []) {
        // Only a plain file name lands in input/: every door sanitizes names already, but runJob is public API too.
        const name = basename(f.name.replace(/\\/g, "/"));
        if (!name || name === "." || name === ".." || name !== f.name)
          throw new JobError("BAD_INPUT", `input file name must be a plain file name, not a path: ${JSON.stringify(f.name)}`);
        writeFileSync(join(dir, "input", name), f.bytes);
      }
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
        run: async (ctx) => {
          const summary = await profileJob(ws, ingested ?? (await ingest(readInputs(dir))), { today: opts.today });
          // Tables are screened now, before METRICS_DRAFT shows cell samples to a model (security §3).
          const t = await screenTables(ws);
          if (t.quarantined.length)
            await ctx.bus.emit({
              type: "warning",
              stage: "PROFILE",
              code: "QUARANTINED",
              message: `${t.quarantined.length} table(s) quarantined for text addressed to a model`,
            });
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
            suspicious: screen,
          });
          // Saved before anything can fail on these definitions, so a later failure can be traced to the draft.
          writeFileSync(join(dir, DRAFTED_METRICS), `${JSON.stringify(draftRecord(draft), null, 2)}\n`);
          const grain = summary.grain as Grain;
          const bounds = summary.tables.flatMap((t) => (t.date_first && t.date_last ? [t.date_first, t.date_last] : [])).sort();
          const periods = bounds.map((d) => periodOf(d, grain)).sort();
          // A last month the data stops early in is left out: a part-month compared with whole months reads as a
          // collapse (found on Online Retail II, which ends on 9 December 2011). The report says so as an assumption.
          const partial = partialLastMonth(summary.tables, grain);
          const first = periods[0] ?? "0000";
          const dropLast = partial !== undefined && first < partial;
          const range = { from: first, to: dropLast ? previousMonth(partial) : (periods.at(-1) ?? "9999"), grain };
          // --yes semantics (interactive review lands with the CLI in M10): drafts are kept as assumptions.
          const defs = draft.validation.accepted.map((d) => ({ ...d, status: "assumed" as const }));
          await saveMetricDefs(ws, defs, catalog, range);
          ctx.log.info("metrics drafted", { source: draft.source, accepted: defs.length, rejected: draft.validation.rejected.length });
          return {
            defs,
            range,
            periodEnd: bounds.at(-1) ?? opts.today,
            source: draft.source,
            ...(dropLast ? { partialPeriod: partial } : {}),
          } satisfies MetricsOutput;
        },
      },
      {
        stage: "AWAIT_CONFIRM",
        skip: () => (opts.autoConfirm === false ? undefined : "metrics kept as assumptions (auto-confirm)"),
        run: async (ctx) => {
          const confirmed = await meta<MetricDef[]>(ws, "confirmed_metrics");
          if (!confirmed) {
            await ctx.bus.emit({ type: "awaiting_confirmation", stage: "AWAIT_CONFIRM" });
            throw new StagePause("AWAIT_CONFIRM", "waiting for the metric definitions to be confirmed");
          }
          const m = (await ctx.output<MetricsOutput>("METRICS_DRAFT")) as MetricsOutput;
          await ws.run(sql`DELETE FROM metric_defs`);
          await saveMetricDefs(ws, confirmed, await loadCatalog(ws), m.range);
          return { defs: confirmed };
        },
      },
      {
        stage: "MEASURE",
        reset: async (w) => {
          await w.run(sql`DELETE FROM insights`);
          await w.run(sql`DELETE FROM decompositions`);
        },
        run: async (ctx) => {
          const m = await metricsOf(ctx);
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
          await w.run(sql`DELETE FROM quarantine WHERE source_id IN (SELECT id FROM sources WHERE kind IN ('document', 'email'))`);
        },
        run: async (ctx) => {
          // Screen every document and email before any model can read it (security §3); tables were screened
          // after PROFILE.
          const screened = await screenDocuments(ws);
          if (screened.quarantined.length)
            await ctx.bus.emit({
              type: "warning",
              stage: "INDEX_DOCS",
              code: "QUARANTINED",
              message: `${screened.quarantined.length} source(s) quarantined for text addressed to a model`,
            });
          // The first run of an in-process embedder downloads and loads its model, which can take minutes.
          await ctx.progress(0, "indexing documents (an in-process embedding model, if used, is downloaded on its first use)");
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
          const m = await metricsOf(ctx);
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
          // The ranking's order (analysis-library §6): each metric family's best whole-metric change, then the
          // strongest single-member change, then the rest. Rates keep their slot through the family rule.
          const top = ranked;
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
          const m = await metricsOf(ctx);
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
            factsheet: sheet,
            facts: factMap,
            extracts: await readExtracts(ws),
            periodEnd: m.periodEnd,
            maxRecommendations: small ? 2 : 5,
            // Small-model mode fits the whole request into free tiers' input-token limits (agent-and-verifier §8.1).
            ...(small ? { maxInputTokens: opts.budget?.inputTokens ?? SMALL_MODEL_INPUT_BUDGET } : {}),
          });
          if (d.request?.steps.length)
            ctx.log.info("decide request trimmed to the input budget", {
              estimate: d.request.estimate,
              untrimmed: d.request.untrimmed,
              steps: d.request.steps,
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
            ...(m.partialPeriod ? { partialPeriod: m.partialPeriod } : {}),
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
      {
        stage: "VERIFY",
        run: async (ctx) => {
          const m = await metricsOf(ctx);
          const draft = JSON.parse(readFileSync(join(dir, "report.draft.json"), "utf8")) as Report;
          // Outputs of an earlier attempt must not outlive this one.
          rmSync(join(dir, "report.json"), { force: true });
          rmSync(join(dir, "diagnostics.json"), { force: true });
          try {
            const r = await verifyReport(draft, {
              ws,
              defs: m.defs,
              catalog: await loadCatalog(ws),
              grain: m.range.grain,
              periodEnd: m.periodEnd,
              judge: deps.model,
            });
            await persistChecks(ws, r.checks);
            // Excerpts of what the shipped claims and facts cite, so the HTML report can show them offline.
            const evidence = await buildEvidence(ws, r.report);
            const verified: Report = evidence.length ? { ...r.report, evidence } : r.report;
            const valid = validateReport(verified);
            if (!valid.ok)
              throw new JobError(
                "INVALID_DRAFT",
                `the verified report breaks the schema: ${valid.issues[0]?.path} ${valid.issues[0]?.message}`,
                valid.issues,
              );
            writeFileSync(join(dir, "report.json"), `${JSON.stringify(verified, null, 2)}\n`);
            const v = r.report.verification;
            return {
              numbers_checked: v.numbers_checked,
              rederived: v.rederived_metrics,
              dropped: v.claims_dropped.length,
              downgraded: v.claims_downgraded.length,
            };
          } catch (err) {
            // V2/V3 mismatches are engine bugs (§7): nothing ships; the evidence goes to a diagnostic bundle.
            if (err instanceof VerifyError)
              writeFileSync(
                join(dir, "diagnostics.json"),
                `${JSON.stringify({ code: err.code, message: err.message, detail: err.diagnostic }, null, 2)}\n`,
              );
            throw err;
          }
        },
      },
      {
        stage: "RENDER",
        run: async () => {
          const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as Report;
          const html = renderReportHtml(report);
          writeFileSync(join(dir, "report.html"), html);
          return { bytes: html.length };
        },
      },
    ];

    let run: RunResult;
    try {
      run = await runPipeline(ws, bus, log, stages);
    } catch (err) {
      if (err instanceof StagePause)
        throw new JobError("AWAITING_CONFIRMATION", `job ${id} is waiting for its metric definitions to be confirmed`, { jobId: id });
      throw err;
    }
    const reportPath = join(dir, "report.json");
    const htmlPath = join(dir, "report.html");
    await bus.emit({ type: "done", report_path: reportPath });
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as Report;
    const draft = JSON.parse(readFileSync(join(dir, "report.draft.json"), "utf8")) as Report;
    return { jobId: id, draftPath: join(dir, "report.draft.json"), reportPath, htmlPath, report, draft, run };
  } finally {
    ws.close();
  }
}

function objectiveText(o: JobOptions): string {
  return o.objective ?? "Grow profit: find what changed, why, and what to do next.";
}
