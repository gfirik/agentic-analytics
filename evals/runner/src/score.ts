// Scoring one report against its answer key (docs/EVALS.md §2). A finding's subject is the change its first
// (code-written) claim states: the metric, the member if any, and the compared periods, read from fact labels. Matching
// is by subject, never by wording, so a model can't score by writing the right words.
import type { AnswerKey, Distractor, Member, Planted } from "@agentic-analytics/eval-generator";
import type { Finding, Report } from "@agentic-analytics/schema";

export interface Subject {
  readonly metric: string;
  readonly member?: Member;
  /** The comparison's earlier side, when the claim has one. */
  readonly before?: string;
  /** The period the change is at (the comparison's later side). */
  readonly period: string;
  /** Which way the measured value moved from `before` to `period`, when the claim cites both points. */
  readonly direction?: "up" | "down";
}

const GRADES = ["observed", "correlated", "document_supported", "intervention_supported"] as const;
const PERIOD = String.raw`(\d{4}-\d{2}(?:-\d{2})?|\d{4}-[QW]\d{1,2})`;
const MEASURED = new RegExp(String.raw`^([a-z][a-z0-9_]*)(?:\[([^=\]]+)=(.+)\])?_${PERIOD}$`);
const DERIVED = new RegExp(String.raw`^I\d+ \S+ ([a-z][a-z0-9_]*)(?:\|([^=]+)=(.+))? ${PERIOD}:`);

/**
 * What a finding is about, from the facts of its first claim (written by code, not the model): the metric, the
 * member, and the compared periods. The change's own fact gives the "after" period; the measured points give the
 * "before" side.
 */
/** A label's period at the key's grain: a day counts as its month; weeks and quarters stay whole ("2026-W12"). */
export const keyPeriod = (p: string) => (/^\d{4}-\d{2}-\d{2}$/.test(p) ? p.slice(0, 7) : p);

/** The `<metric>[dim=member]_<period>` label of a measured fact, parsed (one parser for both eval tiers). */
export function parseMeasured(label: string): { metric: string; dimension?: string; member?: string; period: string } | undefined {
  const m = MEASURED.exec(label);
  if (!m) return undefined;
  return { metric: m[1] as string, ...(m[2] && m[3] ? { dimension: m[2], member: m[3] } : {}), period: m[4] as string };
}

export function subjectOf(f: Finding, report: Report): Subject | undefined {
  const labels = new Map(report.facts.map((x) => [x.id, x.label]));
  const values = new Map(report.facts.map((x) => [x.id, x.value]));
  const ids = f.claims[0]?.facts ?? [];
  const measured = ids.flatMap((id) => {
    const m = MEASURED.exec(labels.get(id) ?? "");
    return m ? [Object.assign(m, { value: values.get(id) })] : [];
  });
  const derived = ids.map((id) => DERIVED.exec(labels.get(id) ?? "")).find((m) => m !== null);
  const head = derived ?? measured[0];
  if (!head) return undefined;
  // Same metric and same member as the change (derived labels write the member as `|dim=value`).
  const points = measured
    .filter((m) => m[1] === head[1] && (m[2] ?? "") === (head[2] ?? "") && (m[3] ?? "") === (head[3] ?? ""))
    .map((m) => ({ period: keyPeriod(m[4] as string), value: m.value }))
    .sort((a, b) => a.period.localeCompare(b.period));
  const periods = points.map((p) => p.period);
  const after = derived ? keyPeriod(derived[4] as string) : (periods.at(-1) as string);
  const before = periods.find((p) => p < after);
  const a = points.find((p) => p.period === after)?.value;
  const b = points.find((p) => p.period === before)?.value;
  const direction = a !== undefined && b !== undefined && a !== b ? (a > b ? "up" : "down") : undefined;
  return {
    metric: canonicalMetrics(report).get(head[1] as string) ?? (head[1] as string),
    ...(head[2] && head[3] ? { member: { dimension: head[2], member: head[3] } } : {}),
    ...(before ? { before } : {}),
    period: after,
    ...(direction ? { direction } : {}),
  };
}

/**
 * The answer key's concept for each report metric, read from its definition (never its id or label wording, which
 * a real model chooses freely: `total_revenue`, `monthly_revenue`, `refund_rate_amount`):
 * - a ratio whose numerator is about refunds → `refund_rate`;
 * - a currency sum of sales (over the table orders are counted in, or of a sales-like column, never a cost) that
 *   filters on one value of another column (`channel = 'wholesale'`) → that channel's revenue slice; with no such
 *   filter → `revenue`;
 * - a count of order ids → `orders`.
 * Anything else keeps its id.
 */
export function canonicalMetrics(report: Report): Map<string, string> {
  const out = new Map<string, string>();
  const metrics = report.metrics ?? [];
  const byId = new Map(metrics.map((m) => [m.id, m]));
  const refundish = (t: string) => /refund|return/i.test(t);
  // A filter that keeps refunded rows (`status = 'refunded'`), not one that excludes them (`status != 'refunded'`).
  const selectsRefunds = (f: string) => /(?<![!<>])=\s*'[^']*refund/i.test(f);
  // Revenue is money from sales: a sum over the table orders are counted in, or of a sales-like column. A cost
  // (supplies, rent, staff on a Costs sheet) is never revenue, whatever its filters.
  const orderTables = new Set(
    metrics
      .filter((x) => (x.type === "count" || x.type === "count_distinct") && /order/i.test(`${x.expression ?? ""} ${x.id}`))
      .flatMap((x) => (x.table ? [x.table] : [])),
  );
  // Whole words only (ids split on "_"): "rent" is a cost, "current" and "rental" are not.
  const words = (t: string) => t.toLowerCase().split(/[^a-z]+/);
  const costly = (t: string) =>
    words(t).some((w) => /^(costs?|expenses?|supplies|supply|rent|staff|salary|salaries|wages?|payroll|spend|spending)$/.test(w));
  const salesLike = (t: string) => words(t).some((w) => /^(amount|sales|revenue|turnover|price|gross|net|income|total)$/.test(w));
  const isSales = (x: (typeof metrics)[number]) => {
    const text = `${x.id} ${x.label} ${x.expression ?? ""}`;
    if (costly(text)) return false;
    return (x.table !== undefined && orderTables.has(x.table)) || salesLike(`${x.expression ?? ""} ${x.id}`);
  };
  for (const m of metrics) {
    const filters = m.filters ?? [];
    let concept = m.id;
    if (m.type === "ratio") {
      const num = m.numerator;
      const numText = num
        ? "metric" in num
          ? `${num.metric} ${(byId.get(num.metric)?.filters ?? []).join(" ")}`
          : `${num.expression} ${(num.filters ?? []).join(" ")}`
        : "";
      if (refundish(numText)) concept = "refund_rate";
    } else if (m.type === "sum" && m.unit === "currency" && !filters.some(selectsRefunds) && isSales(m)) {
      const slice = filters
        .map((f) => /^\s*"?([A-Za-z_][\w ]*)"?\s*=\s*'([^']+)'\s*$/.exec(f))
        .find((x) => x && !/status/i.test(x[1] as string));
      concept = slice ? sliceOf(slice[2] as string, "revenue") : "revenue";
    } else if ((m.type === "count" || m.type === "count_distinct") && /order/i.test(`${m.expression ?? ""} ${m.id}`)) concept = "orders";
    out.set(m.id, concept);
  }
  return out;
}

/** A metric id as the deterministic metric drafts name a channel's slice ("self-serve" → `self_serve_revenue`). */
export const sliceOf = (channel: string, metric: string) => `${channel.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${metric}`;

/**
 * Metrics where a rise is bad news, so a regression moves them up: a whole word of the id (`refund_rate`, `costs`),
 * never a fragment ("returning_customers", "plate_sales").
 */
const UP_IS_WORSE = /(?:^|_)(?:refunds?|returns?|costs?|expenses?|churn|complaints?|late|defects?)(?:_|$)/;

/** The direction a planted event moves its metric: a regression lowers revenue but raises a refund rate. */
export const plantedDirection = (p: Pick<Planted, "type" | "metric">): "up" | "down" =>
  (p.type === "regression") !== UP_IS_WORSE.test(p.metric) ? "down" : "up";

/**
 * A planted event is found by a finding on the same metric (or the slice of a channel the event is in) and the same
 * member, whose comparison spans the event (before < event ≤ after) and, when the claim cites both points, moves
 * the way the event did: a revenue rise across the regression's month is not the regression. A lost client
 * therefore also counts in a June-on-June drop, but a comparison entirely before or after the event does not.
 */
export function matchesPlanted(s: Subject, p: Pick<Planted, "type" | "metric" | "member" | "period" | "driver_alternatives">): boolean {
  const slices = (p.driver_alternatives ?? []).filter((a) => a.dimension === "channel").map((a) => sliceOf(a.member, p.metric));
  if (s.metric !== p.metric && !(p.member === undefined && slices.includes(s.metric))) return false;
  if (!sameMember(s.member, p.member)) return false;
  if (s.direction !== undefined && s.direction !== plantedDirection(p)) return false;
  return s.before !== undefined ? s.before < p.period && p.period <= s.period : s.period === p.period;
}

/**
 * A distractor is reported by any finding at its period on its metric (or one it also moves, or a slice of either).
 * A one-member blip seen one level up (the whole metric at that period) is the same false alarm, so it counts too.
 */
export function matchesDistractor(s: Subject, d: Pick<Distractor, "metric" | "also" | "member" | "period">): boolean {
  const metrics = [d.metric, ...(d.also ?? [])];
  const metricOk = metrics.includes(s.metric) || metrics.some((m) => s.metric.endsWith(`_${m}`));
  const memberOk = sameMember(s.member, d.member) || (d.member !== undefined && s.member === undefined);
  return metricOk && memberOk && s.period === d.period;
}

/**
 * A citation points at a quality key's place: the same file and, when the key names a sheet (`sales.xlsx#Costs!D9`),
 * the same sheet; when both name a cell, the same column. Another sheet of the same workbook is not the planted issue.
 */
export function citesLocation(
  c: Report["data_quality"][number]["citations"][number],
  q: Pick<AnswerKey["quality"][number], "file" | "location">,
  report: Report,
): boolean {
  const source = report.sources.find((s) => s.id === c.source_id);
  if (!source || source.file !== q.file) return false;
  const m = /#([^!]+)!([A-Z]+)?/.exec(q.location);
  if (!m) return true;
  const locator: object | undefined = source.locator;
  const sheet = locator && "sheet" in locator && typeof locator.sheet === "string" ? locator.sheet : undefined;
  if (sheet !== undefined && sheet !== m[1]) return false;
  const column = m[2];
  const cited = (c.cells ?? []).map((x) => /^[A-Z]+/.exec(x)?.[0]);
  return column === undefined || !cited.length || cited.includes(column);
}

function sameMember(a: Member | undefined, b: Member | undefined): boolean {
  if (!b) return a === undefined;
  return a?.dimension === b.dimension && a.member.toLowerCase() === b.member.toLowerCase();
}

export interface PlantedScore {
  readonly id: string;
  readonly detected: boolean;
  /** Rank (1-based) of the matching finding. */
  readonly rank?: number;
  readonly driver?: boolean;
  readonly cause?: boolean;
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
  /**
   * For a completed job whose key has events with good actions: the top recommendation is about one of them and
   * uses one of its good scenario types. A top recommendation about anything else is a miss.
   */
  readonly actionRelevant?: boolean;
  readonly seconds: number;
  readonly tokens: { readonly input: number; readonly output: number };
  /** Which provider and model served each call of this dataset (M13a), with the tokens they spent (M14a). */
  readonly routes?: RouteUse[];
}

/**
 * Calls per route (role · provider · model as sent), with how many came from the cache, and the tokens they spent
 * (M14a): the provider's usage per call, 0 for a cached call, nothing for a call with no count (`unknownTokens`
 * counts those). Results written before M14a have no token fields.
 */
export interface RouteUse {
  readonly role: string;
  readonly route: string;
  readonly calls: number;
  readonly cached: number;
  /** HTTP status ≥ 400 or no response (status 0), as `aa usage` counts it. */
  readonly failed: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** Live calls with no token count in the provider's response. */
  readonly unknownTokens?: number;
}

/**
 * The finding's top driver (the structured `drivers` list code builds from the decomposition, never claim wording)
 * is the expected member or an accepted alternative (the key client's channel).
 */
function driverOk(f: Finding, accepted: readonly Member[]): boolean {
  const top = f.drivers?.[0]?.label.replace(/[“”"]/g, "").trim().toLowerCase();
  return top !== undefined && accepted.some((d) => top === d.member.toLowerCase());
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
      // A job aborted on a wrong number: a recomputed fact (V2), a re-derived one (V3), or a fact citing rows that
      // don't hold it (V5's fact-row check). A shipped report has no mismatches by construction.
      numberMismatch: ["RECOMPUTE_MISMATCH", "REDERIVE_MISMATCH", "CITATION_MISMATCH"].includes(run.error?.code ?? ""),
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
    top.flatMap((f, i) => (subjects[i] !== undefined && matchesPlanted(subjects[i] as Subject, p) ? [{ finding: f, rank: i + 1 }] : []));
  const topRec = report.recommendations[0];
  const scenario = topRec?.impact.method.replace(/^impact\.v1:/, "");
  const planted = key.planted.map((p): PlantedScore => {
    const hits = findingsFor(p);
    const first = hits[0];
    if (!first) return { id: p.id, detected: false };
    const cause = p.cause;
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
    };
  });
  const withActions = key.planted.filter((p) => p.good_actions.length);
  const actionRelevant = withActions.some((p) => {
    const ids = new Set(findingsFor(p).map((h) => h.finding.id));
    return topRec?.because.some((b) => ids.has(b)) && scenario !== undefined && p.good_actions.includes(scenario);
  });
  const findingIds = new Set(report.findings.map((f) => f.id));
  const allSubjects = report.findings.map((f) => subjectOf(f, report));
  return {
    ...base,
    completed: true,
    numberMismatch: false,
    planted,
    distractorsReported: key.distractors
      .filter((d) => allSubjects.some((s) => s !== undefined && matchesDistractor(s, d)))
      .map((d) => d.id),
    qualityFound: key.quality
      .filter((q) => report.data_quality.some((i) => i.kind === q.kind && i.citations.some((c) => citesLocation(c, q, report))))
      .map((q) => q.id),
    citationsChecked: report.verification.citations_checked,
    citationsUnsupported: report.verification.citations_unsupported,
    definitionViolations: report.verification.definition_violations,
    recommendations: report.recommendations.length,
    groundedRecommendations: report.recommendations.filter((r) => r.because.length > 0 && r.because.every((b) => findingIds.has(b))).length,
    findings: report.findings.length,
    ...(withActions.length ? { actionRelevant } : {}),
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
  // EVALS §2: found among the top 5 *with the correct driver* (events without an expected driver need none).
  const found = detected.filter((p) => p.driver !== false);
  const withDriver = detected.filter((p) => p.driver !== undefined);
  const withCause = detected.filter((p) => p.cause !== undefined);
  const withAction = scores.filter((s) => s.actionRelevant !== undefined);
  const sum = (f: (s: DatasetScore) => number) => scores.reduce((a, s) => a + f(s), 0);
  const checked = sum((s) => s.citationsChecked);
  const completed = scores.filter((s) => s.completed);
  const bar = (metric: string, value: number | undefined, text: string, ok: (v: number) => boolean, required = false): Bar => ({
    metric,
    value,
    bar: text,
    // A required bar with nothing to measure fails: a run whose reports quote nothing must not pass on citations.
    pass: value === undefined ? (required ? false : undefined) : ok(value),
  });
  return [
    bar("Jobs completed", share(completed.length, scores.length), "100%", (v) => v === 1),
    bar("Number mismatches", scores.filter((s) => s.numberMismatch).length, "0", (v) => v === 0),
    bar("Planted recall@5", share(found.length, planted.length), "≥ 80%", (v) => v >= 0.8),
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
    bar("Citation precision", share(checked - sum((s) => s.citationsUnsupported), checked), "≥ 95%", (v) => v >= 0.95, true),
    bar(
      "Definition adherence",
      share(completed.filter((s) => s.definitionViolations === 0).length, completed.length),
      "100%",
      (v) => v === 1,
      true,
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
    bar("Recommendation relevance", share(withAction.filter((s) => s.actionRelevant).length, withAction.length), "≥ 70%", (v) => v >= 0.7),
  ];
}
