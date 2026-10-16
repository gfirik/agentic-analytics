// The draft report (report-schema v1): everything EXPLAIN and DECIDE produced, plus sources, metric definitions,
// assumptions, data quality, open questions and every fact referenced (with the facts those depend on). The
// draft is unverified (`verified: false` everywhere, zero verification counts); M9's verifier checks it and M10
// renders it. Text the engine writes here contains no numerals: they live in facts (report-schema §3).
import { describeMetric } from "@agentic-analytics/metrics";
import {
  type Assumption,
  type Fact,
  type Finding,
  findFreeNumerals,
  type MetricDef,
  type OpenQuestion,
  type QualityIssue,
  REPORT_SCHEMA_ID,
  type Recommendation,
  type Report,
  type ReportMetric,
  type Source,
} from "@agentic-analytics/schema";
import { sql, type Workspace } from "@agentic-analytics/store";
import { label, q } from "./claims.ts";
import type { Downgraded, Dropped } from "./explain.ts";
import type { OpenQuestionDraft } from "./tools.ts";

export interface DraftInput {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly engine: Report["engine"];
  readonly period: Report["period"];
  readonly objective: Report["objective"];
  readonly defs: readonly MetricDef[];
  readonly headline: string;
  readonly findings: readonly Finding[];
  readonly recommendations: readonly Recommendation[];
  /** Developer-facing open questions from the analysis (mapped to report wording here). */
  readonly analysisQuestions: readonly string[];
  readonly askedQuestions: readonly OpenQuestionDraft[];
  readonly quarantined: readonly string[];
  readonly dropped: readonly Dropped[];
  readonly downgraded: readonly Downgraded[];
  readonly facts: ReadonlyMap<string, Fact>;
}

const noNumerals = (s: string) => findFreeNumerals(s).length === 0;

async function reportSources(ws: Workspace): Promise<Source[]> {
  const rows = await ws.all<{
    id: string;
    kind: string;
    file: string;
    sha256: string;
    sheet: string | null;
    range_a1: string | null;
    page: number | null;
    section: string[] | null;
    char_start: number | null;
    char_end: number | null;
  }>(sql`SELECT s.id, s.kind, f.name AS file, f.sha256, s.sheet, s.range_a1, s.page, s.section, s.char_start, s.char_end
      FROM sources s JOIN files f ON f.id = s.file_id ORDER BY s.id`);
  return rows.map((r) =>
    r.kind === "table"
      ? {
          id: r.id,
          file: r.file,
          sha256: r.sha256,
          kind: "table" as const,
          external: false,
          locator: { ...(r.sheet ? { sheet: r.sheet } : {}), range: r.range_a1 ?? "A1", table_id: r.id },
        }
      : {
          id: r.id,
          file: r.file,
          sha256: r.sha256,
          kind: r.kind === "email" ? ("email" as const) : ("document" as const),
          external: false,
          locator: {
            ...(r.page ? { page: r.page } : {}),
            ...(r.section?.length ? { section: r.section.join(" › ") } : {}),
            char_start: r.char_start ?? 0,
            char_end: r.char_end ?? 0,
          },
        },
  );
}

/** Report wording for a quality issue: plain words by kind, the file in quotes (file names carry digits). */
const ISSUE_WORDING: Record<string, string> = {
  unit_error: "Some values look like they are in a different unit than the rest of the column",
  negative_quantity: "Some quantities are negative",
  rate_above_100: "Some rates are above one hundred percent",
  future_date: "Some dates are in the future",
  mixed_currency: "Amounts are in more than one currency",
  unparseable_value: "Some values could not be read as numbers or dates",
  date_format_ambiguity: "Some dates could be read as day-month or month-day",
  date_format_conflict: "Dates use conflicting formats",
  date_order: "Dates are out of order",
  entity_link: "The same customer or supplier may appear under different names",
  hidden_sheet: "A hidden sheet was found",
  missing_cached_value: "Some formula results were not saved in the file",
  needs_ocr: "A scanned document has no text layer",
  no_tables_found: "No tables were found in a file",
  duplicate_file: "A file was uploaded twice",
  suspicious_instruction: "Text that looks like instructions to an AI was found; this source was quarantined",
};

async function qualityIssues(ws: Workspace, quarantined: readonly string[]): Promise<QualityIssue[]> {
  const rows = await ws.all<{
    id: string;
    kind: string;
    severity: QualityIssue["severity"];
    file: string | null;
    source_id: string | null;
    rows: number[] | null;
    column_name: string | null;
  }>(
    sql`SELECT i.id, i.kind, i.severity, f.name AS file, i.source_id, i.rows, i.column_name
        FROM quality_issues i LEFT JOIN files f ON f.id = i.file_id ORDER BY i.id`,
  );
  const issues: QualityIssue[] = rows.map((r) => {
    const what = ISSUE_WORDING[r.kind] ?? `Data issue: ${r.kind.replace(/_/g, " ")}`;
    const where = [r.column_name ? `column ${q(r.column_name)}` : "", r.file ? `in ${q(r.file)}` : ""].filter(Boolean).join(" ");
    return {
      id: r.id,
      kind: r.kind,
      severity: r.severity,
      description: `${what}${where ? ` (${where})` : ""}.`,
      citations: r.source_id ? [{ source_id: r.source_id, ...(r.rows?.length ? { rows: r.rows } : {}) }] : [],
    };
  });
  const files = new Map(
    (await ws.all<{ id: string; file: string }>(sql`SELECT s.id, f.name AS file FROM sources s JOIN files f ON f.id = s.file_id`)).map(
      (r) => [r.id, r.file],
    ),
  );
  for (const [i, src] of quarantined.entries())
    issues.push({
      id: `QX${i + 1}`,
      kind: "suspicious_instruction",
      severity: "medium",
      description: `${ISSUE_WORDING.suspicious_instruction} (${q(files.get(src) ?? src)}).`,
      citations: [{ source_id: src }],
    });
  return issues;
}

/** Analysis open questions are developer strings with counts; the report states them without numerals. */
export function reportQuestion(s: string, defs: readonly MetricDef[]): Omit<OpenQuestion, "id"> | undefined {
  const name = (id: string) => q(defs.find((d) => d.id === id)?.label ?? id);
  let m = /^Year-over-year for (\S+) needs/.exec(s);
  if (m)
    return {
      question: `Can you add more than a year of history for ${name(m[1] ?? "")}?`,
      why_it_matters: "Without the same period last year, seasonal swings can't be told apart from real changes.",
      would_change: [],
    };
  m =
    /^(Trend|Trend-break|Anomaly) test needs .* (?:of|periods of) (\S+?)[;.]/.exec(s) ?? /^(Trend-break) test needs .*; (\S+) has/.exec(s);
  if (m)
    return {
      question: `Is a longer history of ${name(m[2] ?? "")} available?`,
      why_it_matters: `The ${(m[1] ?? "").toLowerCase()} test needs more periods than the data covers.`,
      would_change: [],
    };
  m = /^(\S+) has \d+ (\S+) members/.exec(s);
  if (m)
    return {
      question: `Should the smaller ${q(m[2] ?? "")} members of ${name(m[1] ?? "")} be grouped differently?`,
      why_it_matters: "Members beyond the largest ones are analysed together as one group.",
      would_change: [],
    };
  return undefined;
}

/** Every fact id a report part references, plus the inputs those facts were computed from. */
function closure(ids: Iterable<string>, facts: ReadonlyMap<string, Fact>): Fact[] {
  const seen = new Set<string>();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    const f = facts.get(id);
    if (!f) continue;
    seen.add(id);
    stack.push(...(f.computation.inputs ?? []));
  }
  return [...seen].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((id) => facts.get(id) as Fact);
}

export async function buildDraft(ws: Workspace, input: DraftInput): Promise<Report> {
  const sqlOf = new Map((await ws.all<{ id: string; sql: string }>(sql`SELECT id, sql FROM metric_defs`)).map((r) => [r.id, r.sql]));
  const metrics: ReportMetric[] = input.defs.map((d) => ({
    ...d,
    plain: describeMetric(d, input.defs, input.period.grain),
    sql: sqlOf.get(d.id) ?? "",
  }));

  const usesMetric = (f: Finding, metric: string) => f.claims.some((c) => c.facts.some((id) => input.facts.get(id)?.metric_id === metric));
  const assumptions: Assumption[] = input.defs
    .filter((d) => d.status !== "confirmed")
    .map((d, i) => ({
      id: `A${i + 1}`,
      text: `The definition of ${label(d.label)} was drafted automatically and not confirmed by you.`,
      affects: input.findings.filter((f) => usesMetric(f, d.id)).map((f) => f.id),
    }));
  const findings = input.findings.map((f) => ({
    ...f,
    assumptions: assumptions.filter((a) => a.affects.includes(f.id)).map((a) => a.id),
  }));

  const questions: OpenQuestion[] = [];
  const add = (oq: Omit<OpenQuestion, "id">) => {
    if (questions.some((x) => x.question === oq.question)) return;
    questions.push({ id: `Q${questions.length + 1}`, ...oq });
  };
  for (const s of input.analysisQuestions) {
    const oq = reportQuestion(s, input.defs);
    if (oq) add(oq);
  }
  for (const a of input.askedQuestions)
    if (noNumerals(a.question) && noNumerals(a.why_it_matters)) add({ ...a, would_change: findings.map((f) => f.id).slice(0, 1) });

  const bullets = findings.flatMap((f) => f.claims.slice(0, 1)).slice(0, 5);
  const referenced = [
    ...findings.flatMap((f) => [...f.claims.flatMap((c) => c.facts), ...(f.drivers ?? []).flatMap((d) => [d.fact, d.share_of_change])]),
    ...input.recommendations.flatMap((r) => [
      ...r.rationale.flatMap((c) => c.facts),
      r.impact.low,
      r.impact.high,
      ...r.impact.inputs,
      r.check.threshold,
    ]),
  ];
  const facts = closure(referenced, input.facts);

  return {
    schema: REPORT_SCHEMA_ID,
    job_id: input.jobId,
    generated_at: input.generatedAt,
    engine: input.engine,
    period: input.period,
    objective: input.objective,
    sources: await reportSources(ws),
    metrics,
    assumptions,
    data_quality: await qualityIssues(ws, input.quarantined),
    summary: { headline: input.headline, bullets },
    findings,
    recommendations: [...input.recommendations],
    open_questions: questions,
    facts,
    verification: {
      numbers_checked: 0,
      numbers_mismatched: 0,
      rederived_metrics: 0,
      rederivation_mismatches: 0,
      definition_violations: 0,
      citations_checked: 0,
      citations_unsupported: 0,
      claims_dropped: [...input.dropped],
      claims_downgraded: [...input.downgraded],
    },
  };
}
