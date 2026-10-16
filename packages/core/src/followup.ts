// Follow-ups on a finished job (interfaces §1–§3): ask a question about the report, and explain a number. Both
// open the job's workspace read-only in spirit (nothing is written) and follow the report's rules: an answer is a
// list of claims that went through the verifier, and an explanation is the stored computation, never a new one.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { answerQuestion } from "@agentic-analytics/agent";
import { describeMetric, type Grain, loadCatalog } from "@agentic-analytics/metrics";
import type { ModelClient } from "@agentic-analytics/models";
import type { Claim, Fact, Finding, MetricDef, Report } from "@agentic-analytics/schema";
import { ident, sql, tableName, Workspace } from "@agentic-analytics/store";
import { parseMeasured, verifyReport } from "@agentic-analytics/verify";

export class FollowUpError extends Error {
  constructor(
    readonly code: "NO_REPORT" | "UNKNOWN_FACT",
    message: string,
  ) {
    super(message);
    this.name = "FollowUpError";
  }
}

interface JobMetrics {
  readonly defs: MetricDef[];
  readonly grain: Grain;
  readonly periodEnd: string;
}

function readReport(dir: string): Report {
  const path = join(dir, "report.json");
  if (!existsSync(path)) throw new FollowUpError("NO_REPORT", "the job has no verified report yet");
  return JSON.parse(readFileSync(path, "utf8")) as Report;
}

async function jobMetrics(ws: Workspace): Promise<JobMetrics> {
  const out = async (stage: string) =>
    (await ws.one<{ o: string | null }>(sql`SELECT output::VARCHAR AS o FROM job_stages WHERE stage = ${stage}`))?.o;
  const drafted = JSON.parse((await out("METRICS_DRAFT")) ?? "{}") as {
    defs?: MetricDef[];
    range?: { grain: Grain };
    periodEnd?: string;
  };
  const confirmed = JSON.parse((await out("AWAIT_CONFIRM")) ?? "null") as { defs?: MetricDef[] } | null;
  return {
    defs: confirmed?.defs ?? drafted.defs ?? [],
    grain: drafted.range?.grain ?? "month",
    periodEnd: drafted.periodEnd ?? "9999-12-31",
  };
}

export interface Answer {
  readonly question: string;
  /** Verified claims (placeholders resolve against `facts`). */
  readonly claims: Claim[];
  /** The facts the claims use, with their values and provenance. */
  readonly facts: Fact[];
  /** Claims the verifier dropped, with the reason. */
  readonly dropped: { claim: string; reason: string }[];
  readonly notCovered?: string;
}

/**
 * Answers a question from the verified report. The planner's claims are placed in a scratch finding of the report
 * and the whole report is verified again, so an answer passes V1–V8 exactly like a report claim (§7).
 */
export async function askJob(dir: string, question: string, model: ModelClient): Promise<Answer> {
  const report = readReport(dir);
  const draft = await answerQuestion(model, question, report);
  if (!draft.claims.length)
    return { question, claims: [], facts: [], dropped: [], ...(draft.notCovered ? { notCovered: draft.notCovered } : {}) };
  const n = Math.max(0, ...report.findings.map((f) => Number(f.id.slice(1)))) + 1;
  const scratch: Finding = {
    id: `F${n}`,
    type: report.findings[0]?.type ?? "regression",
    severity: "low",
    title: question.slice(0, 200),
    claims: draft.claims,
    method: "answer to a follow-up question",
    confidence: "low",
    confidence_reasons: [],
    assumptions: [],
  };
  const ws = await Workspace.open(join(dir, "job.duckdb"));
  try {
    const m = await jobMetrics(ws);
    const before = new Set(report.verification.claims_dropped.map((d) => d.claim));
    const v = await verifyReport(
      { ...report, findings: [...report.findings, scratch] },
      { ws, defs: m.defs, catalog: await loadCatalog(ws), grain: m.grain, periodEnd: m.periodEnd, judge: model },
    );
    const kept = v.report.findings.find((f) => f.id === scratch.id)?.claims ?? [];
    const asked = new Set(draft.claims.map((c) => c.text));
    const used = new Set(kept.flatMap((c) => c.facts));
    return {
      question,
      claims: kept,
      facts: v.report.facts.filter((f) => used.has(f.id)),
      dropped: v.report.verification.claims_dropped.filter((d) => asked.has(d.claim) && !before.has(d.claim)),
      ...(draft.notCovered ? { notCovered: draft.notCovered } : {}),
    };
  } finally {
    ws.close();
  }
}

export interface FactExplanation {
  readonly fact: Fact;
  /** For a measured fact: the metric definition, in YAML-ready form and in plain words. */
  readonly definition?: { readonly metric: MetricDef; readonly text: string };
  /** For a function fact: its inputs, each a fact with its own provenance. */
  readonly inputs: Fact[];
  /** Up to `limit` cited input rows per table, as stored after normalisation. */
  readonly rows: { readonly source_id: string; readonly rows: Record<string, unknown>[] }[];
}

/** The computation behind one number: its SQL and parameters (or function and inputs), definition and input rows. */
export async function explainFact(dir: string, factId: string, limit = 20): Promise<FactExplanation> {
  const report = readReport(dir);
  const byId = new Map(report.facts.map((f) => [f.id, f]));
  const fact = byId.get(factId);
  if (!fact) throw new FollowUpError("UNKNOWN_FACT", `no fact ${factId} in the report`);
  const ws = await Workspace.open(join(dir, "job.duckdb"));
  try {
    const m = await jobMetrics(ws);
    const measured = fact.computation.kind === "sql" ? parseMeasured(fact.label) : undefined;
    const metric = m.defs.find((d) => d.id === (fact.metric_id ?? measured?.metric));
    const rows: FactExplanation["rows"] = [];
    for (const c of fact.citations) {
      if (!c.rows?.length || !/^T\d+$/.test(c.source_id)) continue;
      const take = c.rows.slice(0, limit);
      const found = await ws.all(
        sql`SELECT * FROM ${ident(tableName(c.source_id))} WHERE list_contains(${JSON.stringify(take)}::INTEGER[], _row) ORDER BY _row`,
      );
      rows.push({ source_id: c.source_id, rows: found });
    }
    return {
      fact,
      ...(metric ? { definition: { metric, text: describeMetric(metric, m.defs, m.grain) } } : {}),
      inputs: (fact.computation.inputs ?? []).map((id) => byId.get(id)).filter((f): f is Fact => f !== undefined),
      rows,
    };
  } finally {
    ws.close();
  }
}
