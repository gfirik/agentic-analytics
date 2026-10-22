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

/** A word matched in any case ("dec", "Dec", "DEC"), built without the `i` flag so "May" can stay case-sensitive. */
const anyCase = (w: string) => [...w].map((c) => (/\p{L}/u.test(c) ? `[${c.toUpperCase()}${c.toLowerCase()}]` : c)).join("");
/** Month words. "may" is a verb, so only "May" or "MAY" count. */
const MONTH = `(?:${[
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sept",
  "sep",
  "oct",
  "nov",
  "dec",
]
  .map(anyCase)
  .join("|")}|May|MAY)\\.?`; // an abbreviation may end with a full stop ("Dec.")
const DAY = "\\d{1,2}(?:st|nd|rd|th)?";
const YEAR = "(?:19|20)\\d{2}";
const SP = "\\s{1,3}";
// Every pattern is forward and bounded (no lookbehind scans, no unbounded runs), so long text stays linear.
const DATE_PATTERNS = [
  new RegExp(`\\b${YEAR}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\\d|3[01]))?\\b`, "g"), // 2026-04, 2026-04-12
  new RegExp(`\\b${YEAR}-?(?:Q[1-4]|H[12]|W(?:0?[1-9]|[1-4]\\d|5[0-3]))\\b`, "g"), // 2025-Q4, 2026H1, 2025-W51
  new RegExp(`\\b(?:Q[1-4]|H[12])${SP}${YEAR}\\b`, "g"), // Q1 2026
  new RegExp(`(?<![\\p{L}])${MONTH}${SP}${DAY}(?:,?${SP}${YEAR})?(?![\\p{L}\\d])`, "gu"), // April 12, March 15, 2026
  new RegExp(`\\b${DAY}${SP}(?:of${SP})?${MONTH}(?:,?${SP}${YEAR})?(?![\\p{L}])`, "gu"), // 12 April, 12th of April 2026
  new RegExp(`(?<![\\p{L}])${MONTH},?${SP}${YEAR}\\b`, "gu"), // March 2026, MAY 2026
  new RegExp(`\\b${YEAR}(?=[- ]?(?:год[уа]?|г\\.|yil|йил))`, "gu"), // 2026 году, 2026-yil
];
const QUOTED = /“[^”]*”|"[^"]*"/g;

/**
 * The years of a job's own periods, read only from where a period sits in a fact label, so neither an amount nor a
 * member value can vouch for itself: the part before the first ":" (after it come calc keys such as
 * `delta:<member>`), with bracketed members (`[store=2000-01]`) removed. There, the last period-shaped token (`2026-04`,
 * `2025-Q4`, `2026-W51`) counts, and so does a bare year that ends the label after "_" (a yearly period,
 * `revenue_2025`) or that is the whole string (`report.period.from`).
 */
export function periodYears(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  const shaped = new RegExp(`^(${YEAR})(?:-(?:0[1-9]|1[0-2])(?:-\\d{2})?|-?(?:Q[1-4]|H[12]|W\\d{1,2}))$`);
  const whole = new RegExp(`^${YEAR}$`);
  const suffix = new RegExp(`_(${YEAR})$`);
  for (const t of texts) {
    const head = (t.split(":")[0] ?? "").replace(/\[[^\]]*\]/g, " ");
    if (whole.test(head.trim())) out.add(head.trim());
    const y = suffix.exec(head.trim())?.[1];
    if (y) out.add(y);
    // Only the last period-shaped token: a series id written `metric|dim=value` puts its member (which may hold
    // spaces and a period-like "2000-01") before the period, never after it.
    const last = head
      .split(/[\s_,;()]+/)
      .map((token) => shaped.exec(token)?.[1])
      .filter((y): y is string => Boolean(y))
      .at(-1);
    if (last) out.add(last);
  }
  return out;
}

/**
 * Numerals in model-written text that are not placeholders, dates or quoted source text: any decimal digit, in any
 * script ("٣٠٪" counts). Any hit is a "free numeral", which the verifier rejects (agent-and-verifier §7, V1).
 *
 * A date has a month next to it, or an ISO, quarter, half or week form. A bare year ("in 2026", "2025 vs 2026") is a
 * date only when it is one of `years`, the job's own period years (`periodYears`); without them, never: "we lost
 * 2000 customers" and "fell by 1999" are counts.
 */
export function findFreeNumerals(text: string, years: ReadonlySet<string> = new Set()): string[] {
  let rest = text.replace(PLACEHOLDER, " ").replace(QUOTED, " ");
  for (const p of DATE_PATTERNS) rest = rest.replace(p, (m) => " ".repeat(m.length));
  if (years.size) rest = rest.replace(new RegExp(`\\b${YEAR}\\b`, "g"), (m) => (years.has(m) ? " ".repeat(m.length) : m));
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
  // The report's own period years: a bare "2026" in its text is a date only if the job covers 2026.
  const years = periodYears([report.period.from, report.period.to, ...report.facts.map((f) => f.label)]);
  const text = (path: string, value: string) => {
    for (const ref of placeholders(value)) fact(path, ref);
    const free = findFreeNumerals(value, years);
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
    for (const [j, r] of f.confidence_reasons.entries()) text(`${p}.confidence_reasons[${j}]`, r);
    for (const [j, d] of (f.drivers ?? []).entries()) {
      fact(`${p}.drivers[${j}].fact`, d.fact);
      fact(`${p}.drivers[${j}].share_of_change`, d.share_of_change);
      text(`${p}.drivers[${j}].label`, d.label);
    }
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
