// Cross-reference rules for report v1 that a JSON Schema can't express (docs/specs/report-schema.md §3–4):
// every referenced id exists, every number in any human-readable text field is a `{{N…}}` placeholder
// (report-schema §3), and every citation points at a source. Only `verification.claims_dropped/downgraded`
// are exempt: they quote rejected model text verbatim, which is the point of listing them.
import type { Citation, Claim, Report } from "./report.ts";

export interface IntegrityIssue {
  readonly path: string;
  readonly message: string;
}

const PLACEHOLDER = /\{\{(N\d+)\}\}/g;

/** Fact ids referenced as `{{N12}}` placeholders in a text, in order of appearance. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? "");
}

/** Month words that make a number a day or a year. "may" counts only as "May": "the top 3 may churn" is not a date. */
const cap = (w: string) => `[${w[0]?.toUpperCase()}${w[0]}]${w.slice(1)}`;
const FULL = ["january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december"];
const MONTH = `(?:${FULL.map(cap).join("|")}|May|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\\.?`;
/** A year is a date only next to a date word, a month or another year (a bare "2000" may be a count). */
const YEAR_BEFORE = `(?:${MONTH},?|[Ii]n|[Ss]ince|[Bb]y|[Ff]rom|[Tt]o|[Uu]ntil|[Tt]hrough|[Oo]f|[Dd]uring|[Bb]efore|[Aa]fter|FY|[Yy]ear|[Вв]|[Сс]|[Дд]о|[Пп]о|(?:19|20)\\d{2}\\s*(?:and|or|to|[–—-]))`;
const DATE_PATTERNS = [
  /\b\d{4}-\d{2}(?:-\d{2})?\b/g, // 2026-04, 2026-04-12
  new RegExp(`\\b\\d{1,2}\\s+${MONTH}(?![\\p{L}])`, "gu"), // 12 April, 12 Apr
  new RegExp(`(?<![\\p{L}])${MONTH}\\s+\\d{1,2}\\b`, "gu"), // April 12
  new RegExp(`(?<=${YEAR_BEFORE}\\s+)(?:19|20)\\d{2}\\b`, "gu"), // in 2026, March 2026, FY 2026, 2025 and 2026
  /(?:19|20)\d{2}(?=[- ]?(?:год[уа]?|г\.|yil|йил))/gu, // 2026 году, 2026-yil
];
const QUOTED = /“[^”]*”|"[^"]*"/g;

/**
 * Numerals in model-written text that are not placeholders, dates or quoted source text: any decimal digit, in any
 * script ("٣٠٪" counts). Any hit is a "free numeral", which the verifier rejects (agent-and-verifier §7, V1).
 */
export function findFreeNumerals(text: string): string[] {
  let rest = text.replace(PLACEHOLDER, " ").replace(QUOTED, " ");
  // Date spans are found on the text as written, then blanked together (a blanked year can't vouch for the next).
  const spans = DATE_PATTERNS.flatMap((p) => [...rest.matchAll(p)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length] as const));
  for (const [a, b] of spans) rest = `${rest.slice(0, a)}${" ".repeat(b - a)}${rest.slice(b)}`;
  return rest.match(/\p{Nd}[\p{Nd},.]*/gu) ?? [];
}

export function checkReportIntegrity(report: Report): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  const factIds = uniqueIds(report.facts, "facts", add);
  const sourceIds = uniqueIds(report.sources, "sources", add);
  const findingIds = uniqueIds(report.findings, "findings", add);
  const recIds = uniqueIds(report.recommendations, "recommendations", add);
  const metricIds = uniqueIds(report.metrics, "metrics", add);
  const assumptionIds = uniqueIds(report.assumptions, "assumptions", add);
  uniqueIds(report.open_questions, "open_questions", add);
  uniqueIds(report.data_quality, "data_quality", add);

  const fact = (path: string, ref: string) => {
    if (!factIds.has(ref)) add(path, `unknown fact ${ref}`);
  };
  const metric = (path: string, ref: string) => {
    if (!metricIds.has(ref)) add(path, `unknown metric ${ref}`);
  };
  const citations = (path: string, list: readonly Citation[]) =>
    list.forEach((c, i) => {
      if (!sourceIds.has(c.source_id)) add(`${path}[${i}].source_id`, `unknown source ${c.source_id}`);
    });
  const text = (path: string, value: string) => {
    for (const ref of placeholders(value)) fact(path, ref);
    const free = findFreeNumerals(value);
    if (free.length) add(path, `free numerals not backed by a fact: ${free.join(", ")}`);
  };
  const claim = (path: string, c: Claim) => {
    text(`${path}.text`, c.text);
    for (const [i, f] of c.facts.entries()) fact(`${path}.facts[${i}]`, f);
    for (const ref of placeholders(c.text)) {
      if (!c.facts.includes(ref)) add(`${path}.facts`, `placeholder {{${ref}}} is not listed in claim.facts`);
    }
    citations(`${path}.citations`, c.citations);
  };

  report.facts.forEach((f, i) => {
    citations(`facts[${i}].citations`, f.citations);
    for (const [j, ref] of (f.computation.inputs ?? []).entries()) fact(`facts[${i}].computation.inputs[${j}]`, ref);
    if (f.metric_id) metric(`facts[${i}].metric_id`, f.metric_id);
  });

  text("summary.headline", report.summary.headline);
  for (const [i, c] of report.summary.bullets.entries()) claim(`summary.bullets[${i}]`, c);

  report.findings.forEach((f, i) => {
    const p = `findings[${i}]`;
    text(`${p}.title`, f.title);
    for (const [j, c] of f.claims.entries()) claim(`${p}.claims[${j}]`, c);
    f.drivers?.forEach((d, j) => {
      fact(`${p}.drivers[${j}].fact`, d.fact);
      fact(`${p}.drivers[${j}].share_of_change`, d.share_of_change);
    });
    for (const [j, r] of f.confidence_reasons.entries()) text(`${p}.confidence_reasons[${j}]`, r);
    for (const [j, d] of (f.drivers ?? []).entries()) text(`${p}.drivers[${j}].label`, d.label);
    f.assumptions.forEach((a, j) => {
      if (!assumptionIds.has(a)) add(`${p}.assumptions[${j}]`, `unknown assumption ${a}`);
    });
  });

  report.recommendations.forEach((r, i) => {
    const p = `recommendations[${i}]`;
    text(`${p}.action`, r.action);
    r.because.forEach((b, j) => {
      if (!findingIds.has(b)) add(`${p}.because[${j}]`, `unknown finding ${b}`);
    });
    for (const [j, c] of r.rationale.entries()) claim(`${p}.rationale[${j}]`, c);
    metric(`${p}.impact.metric_id`, r.impact.metric_id);
    fact(`${p}.impact.low`, r.impact.low);
    fact(`${p}.impact.high`, r.impact.high);
    for (const [j, ref] of r.impact.inputs.entries()) fact(`${p}.impact.inputs[${j}]`, ref);
    metric(`${p}.check.metric_id`, r.check.metric_id);
    fact(`${p}.check.threshold`, r.check.threshold);
    if (r.not_advised) text(`${p}.not_advised`, r.not_advised);
    text(`${p}.risk`, r.risk);
    text(`${p}.impact.horizon`, r.impact.horizon);
  });

  const anyId = new Set([...findingIds, ...recIds, ...metricIds]);
  for (const [i, q] of report.open_questions.entries()) {
    text(`open_questions[${i}].question`, q.question);
    text(`open_questions[${i}].why_it_matters`, q.why_it_matters);
    for (const [j, ref] of q.would_change.entries()) {
      if (!anyId.has(ref)) add(`open_questions[${i}].would_change[${j}]`, `unknown finding/recommendation ${ref}`);
    }
  }
  for (const [i, a] of report.assumptions.entries()) {
    text(`assumptions[${i}].text`, a.text);
    for (const [j, ref] of a.affects.entries()) {
      if (!anyId.has(ref)) add(`assumptions[${i}].affects[${j}]`, `unknown finding/recommendation/metric ${ref}`);
    }
  }
  for (const [i, q] of report.data_quality.entries()) {
    text(`data_quality[${i}].description`, q.description);
    citations(`data_quality[${i}].citations`, q.citations);
  }
  report.evidence?.forEach((e, i) => {
    if (!sourceIds.has(e.source_id)) add(`evidence[${i}].source_id`, `unknown source ${e.source_id}`);
  });

  return issues;
}

function uniqueIds(items: readonly { id: string }[], path: string, add: (path: string, message: string) => void): Set<string> {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item.id)) add(`${path}[${i}].id`, `duplicate id ${item.id}`);
    seen.add(item.id);
  });
  return seen;
}
