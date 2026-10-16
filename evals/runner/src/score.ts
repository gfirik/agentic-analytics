// Scoring one report against its answer key (docs/EVALS.md §2). A finding's subject is the change its first
// (code-written) claim states: the metric, the member if any, and the period, read from the fact labels. Matching
// is by subject, never by wording, so a model can't score by writing the right words.
import type { AnswerKey, Member, Planted } from "@agentic-analytics/eval-generator";
import type { Finding, Report } from "@agentic-analytics/schema";

export interface Subject {
  readonly metric: string;
  readonly member?: Member;
  readonly period: string;
}

const GRADES = ["observed", "correlated", "document_supported", "intervention_supported"] as const;
const MEASURED = /^([a-z][a-z0-9_]*)(?:\[([^=\]]+)=(.+)\])?_(\d{4}-\d{2}(?:-\d{2})?|\d{4}-[QW]\d{1,2})$/;
const DERIVED = /^I\d+ \S+ ([a-z][a-z0-9_]*)(?:\|([^=]+)=(.+))? (\d{4}-\d{2}(?:-\d{2})?|\d{4}-[QW]\d{1,2}):/;

/** What a finding is about, from the facts of its first claim. */
export function subjectOf(f: Finding, report: Report): Subject | undefined {
  const labels = new Map(report.facts.map((x) => [x.id, x.label]));
  const ids = f.claims[0]?.facts ?? [];
  // The change's own fact (its period is the "after" side) first; a measured point only when there is none.
  const ordered = [...ids.filter((id) => DERIVED.test(labels.get(id) ?? "")), ...ids];
  for (const id of ordered) {
    const label = labels.get(id) ?? "";
    const m = DERIVED.exec(label) ?? MEASURED.exec(label);
    if (m)
      return {
        metric: m[1] as string,
        ...(m[2] && m[3] ? { member: { dimension: m[2], member: m[3] } } : {}),
        period: (m[4] as string).slice(0, 7),
      };
  }
  return undefined;
}

const monthIndex = (p: string) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7));

/**
 * Same metric (or a channel slice of it, e.g. `wholesale_revenue` for revenue), same member, and the period within
 * ±1 of the target's, or any later period for a lasting change (a lost client still shows in a June-on-June drop).
 */
export function matches(s: Subject, target: { metric: string; member?: Member; period: string; persists?: boolean }, window = 1): boolean {
  const metricOk = s.metric === target.metric || (!target.member && s.metric.endsWith(`_${target.metric}`));
  const memberOk = target.member
    ? s.member?.dimension === target.member.dimension && s.member.member.toLowerCase() === target.member.member.toLowerCase()
    : s.member === undefined;
  const d = monthIndex(s.period) - monthIndex(target.period);
  return metricOk && memberOk && (Math.abs(d) <= window || (target.persists === true && d > 0));
}

export interface PlantedScore {
  readonly id: string;
  readonly detected: boolean;
  /** Rank (1-based) of the matching finding. */
  readonly rank?: number;
  readonly driver?: boolean;
  readonly cause?: boolean;
  /** The top recommendation's scenario is one of the good actions (only for P-events that have good actions). */
  readonly relevantAction?: boolean;
}

export interface DatasetScore {
  readonly dataset: string;
  readonly completed: boolean;
  readonly error?: string;
  /** The job failed on a V2/V3 mismatch (an engine bug). */
  readonly numberMismatch: boolean;
  readonly planted: PlantedScore[];
  readonly distractorsReported: string[];
  readonly distractors: number;
  readonly qualityFound: string[];
  readonly quality: number;
  readonly citationsChecked: number;
  readonly citationsUnsupported: number;
  readonly definitionViolations: number;
  readonly recommendations: number;
  readonly groundedRecommendations: number;
  readonly findings: number;
  readonly seconds: number;
  readonly tokens: { readonly input: number; readonly output: number };
}

/** The finding's top driver is the expected member (or an accepted alternative, e.g. the client's channel). */
function driverOk(f: Finding, accepted: readonly Member[]): boolean {
  const clean = (s: string) => s.replace(/[“”"]/g, "").trim().toLowerCase();
  const top = f.drivers?.[0]?.label;
  if (top) return accepted.some((d) => clean(top) === d.member.toLowerCase());
  return f.claims.some((c) => accepted.some((d) => c.text.toLowerCase().includes(`by ${d.dimension}, “${d.member.toLowerCase()}”`)));
}

export function scoreReport(
  report: Report | undefined,
  key: AnswerKey,
  run: { seconds: number; tokens: { input: number; output: number }; error?: { code?: string; message: string } },
): DatasetScore {
  const base = {
    dataset: key.dataset,
    distractors: key.distractors.length,
    quality: key.quality.length,
    seconds: run.seconds,
    tokens: run.tokens,
  };
  if (!report)
    return {
      ...base,
      completed: false,
      ...(run.error ? { error: `${run.error.code ?? "ERROR"}: ${run.error.message}` } : {}),
      numberMismatch: run.error?.code === "RECOMPUTE_MISMATCH" || run.error?.code === "REDERIVE_MISMATCH",
      planted: key.planted.map((p) => ({ id: p.id, detected: false })),
      distractorsReported: [],
      qualityFound: [],
      citationsChecked: 0,
      citationsUnsupported: 0,
      definitionViolations: 0,
      recommendations: 0,
      groundedRecommendations: 0,
      findings: 0,
    };
  const files = new Map(report.sources.map((s) => [s.id, s.file ?? ""]));
  const top = report.findings.slice(0, 5);
  const subjects = top.map((f) => subjectOf(f, report));
  // Every top-5 finding about the planted event: the first gives the rank; the driver, cause and action may come
  // from any of them (one engine finding states the change, a sibling on a channel metric may hold the cause).
  const findingsFor = (p: Planted) =>
    top.flatMap((f, i) => (subjects[i] !== undefined && matches(subjects[i] as Subject, p) ? [{ finding: f, rank: i + 1 }] : []));
  const topRec = report.recommendations[0];
  const scenario = topRec?.impact.method.replace(/^impact\.v1:/, "");
  const planted = key.planted.map((p): PlantedScore => {
    const hits = findingsFor(p);
    const first = hits[0];
    if (!first) return { id: p.id, detected: false };
    const cause = p.cause;
    const ids = new Set(hits.map((h) => h.finding.id));
    return {
      id: p.id,
      detected: true,
      rank: first.rank,
      ...(p.driver ? { driver: hits.some((h) => driverOk(h.finding, [p.driver as Member, ...(p.driver_alternatives ?? [])])) } : {}),
      ...(cause
        ? {
            cause: hits.some((h) =>
              h.finding.claims.some(
                (c) =>
                  GRADES.indexOf(c.causal_grade ?? "observed") >= GRADES.indexOf(cause.grade_at_least) &&
                  c.citations.some((x) => files.get(x.source_id) === cause.doc),
              ),
            ),
          }
        : {}),
      ...(p.good_actions.length && topRec?.because.some((b) => ids.has(b))
        ? { relevantAction: scenario !== undefined && p.good_actions.includes(scenario) }
        : {}),
    };
  });
  const findingIds = new Set(report.findings.map((f) => f.id));
  const allSubjects = report.findings.map((f) => subjectOf(f, report));
  return {
    ...base,
    completed: true,
    numberMismatch: false,
    planted,
    distractorsReported: key.distractors.filter((d) => allSubjects.some((s) => s !== undefined && matches(s, d, 0))).map((d) => d.id),
    qualityFound: key.quality
      .filter((q) => report.data_quality.some((i) => i.kind === q.kind && i.citations.some((c) => files.get(c.source_id) === q.file)))
      .map((q) => q.id),
    citationsChecked: report.verification.citations_checked,
    citationsUnsupported: report.verification.citations_unsupported,
    definitionViolations: report.verification.definition_violations,
    recommendations: report.recommendations.length,
    groundedRecommendations: report.recommendations.filter((r) => r.because.length > 0 && r.because.every((b) => findingIds.has(b))).length,
    findings: report.findings.length,
  };
}

export interface Bar {
  readonly metric: string;
  readonly value: number | undefined;
  readonly bar: string;
  readonly pass: boolean | undefined;
}

const share = (n: number, d: number) => (d === 0 ? undefined : n / d);

/** The suite-level metrics and their v0.1 bars (docs/EVALS.md §2). */
export function summarize(scores: readonly DatasetScore[]): Bar[] {
  const planted = scores.flatMap((s) => s.planted);
  const detected = planted.filter((p) => p.detected);
  const withDriver = detected.filter((p) => p.driver !== undefined);
  const withCause = detected.filter((p) => p.cause !== undefined);
  const withAction = detected.filter((p) => p.relevantAction !== undefined);
  const sum = (f: (s: DatasetScore) => number) => scores.reduce((a, s) => a + f(s), 0);
  const checked = sum((s) => s.citationsChecked);
  const completed = scores.filter((s) => s.completed);
  const bar = (metric: string, value: number | undefined, text: string, ok: (v: number) => boolean): Bar => ({
    metric,
    value,
    bar: text,
    pass: value === undefined ? undefined : ok(value),
  });
  return [
    bar("Jobs completed", share(completed.length, scores.length), "100%", (v) => v === 1),
    bar("Number mismatches", scores.filter((s) => s.numberMismatch).length, "0", (v) => v === 0),
    bar("Planted recall@5", share(detected.length, planted.length), "≥ 80%", (v) => v >= 0.8),
    bar("Driver accuracy", share(withDriver.filter((p) => p.driver).length, withDriver.length), "≥ 90%", (v) => v >= 0.9),
    bar("Cause grade accuracy", share(withCause.filter((p) => p.cause).length, withCause.length), "≥ 80%", (v) => v >= 0.8),
    bar(
      "Distractor FP rate",
      share(
        sum((s) => s.distractorsReported.length),
        sum((s) => s.distractors),
      ),
      "≤ 10%",
      (v) => v <= 0.1,
    ),
    bar(
      "Quality-issue recall",
      share(
        sum((s) => s.qualityFound.length),
        sum((s) => s.quality),
      ),
      "≥ 90%",
      (v) => v >= 0.9,
    ),
    bar("Citation precision", share(checked - sum((s) => s.citationsUnsupported), checked), "≥ 95%", (v) => v >= 0.95),
    bar(
      "Definition adherence",
      share(completed.filter((s) => s.definitionViolations === 0).length, completed.length),
      "100%",
      (v) => v === 1,
    ),
    bar(
      "Recommendation grounding",
      share(
        sum((s) => s.groundedRecommendations),
        sum((s) => s.recommendations),
      ),
      "100%",
      (v) => v === 1,
    ),
    bar("Recommendation relevance", share(withAction.filter((p) => p.relevantAction).length, withAction.length), "≥ 70%", (v) => v >= 0.7),
  ];
}
