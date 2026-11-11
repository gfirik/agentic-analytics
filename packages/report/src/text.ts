// Plain-text views of a verified report for chat-like doors (MCP, Telegram, the CLI): placeholders are filled with
// the formatted fact values, never with recomputed numbers. Interfaces §3–§4.
import { type Fact, FILE_NOT_READ_KINDS, type Report } from "@agentic-analytics/schema";
import { formatFact, recommendationsNote } from "./format.ts";

/** Replaces each `{{N…}}` with its fact's formatted value (an unknown id stays as written). */
export function fillPlaceholders(text: string, facts: ReadonlyMap<string, Fact> | readonly Fact[]): string {
  const byId = facts instanceof Map ? facts : new Map((facts as readonly Fact[]).map((f) => [f.id, f]));
  return text.replace(/\{\{(N\d+)\}\}/g, (m, id: string) => {
    const f = byId.get(id);
    return f ? formatFact(f) : m;
  });
}

export interface SummaryOptions {
  readonly findings?: number;
  readonly recommendations?: number;
}

/**
 * The headline, the top findings (title and first claim), the top recommendations and a notice when metrics were
 * assumed rather than confirmed. Numbers are the report's facts.
 */
export function reportSummaryText(report: Report, o: SummaryOptions = {}): string {
  const facts = new Map(report.facts.map((f) => [f.id, f]));
  const fill = (t: string) => fillPlaceholders(t, facts);
  const lines = [fill(report.summary.headline), ""];
  // A job that read no numbers names what it did read (file names and kinds only: a count would be a free numeral).
  if (report.summary.no_numbers) {
    const read = [...new Set(report.sources.filter((s) => !s.external).map((s) => `${s.file} (${s.kind})`))];
    lines.push(read.length ? `Read: ${read.join(", ")}` : "Read: nothing", "");
  }
  const findings = report.findings.slice(0, o.findings ?? 3);
  if (findings.length) lines.push("Findings:");
  for (const f of findings) {
    lines.push(`• ${fill(f.title)}`);
    const c = f.claims[0];
    if (c) lines.push(`  ${fill(c.text)}`);
  }
  const recs = report.recommendations.slice(0, o.recommendations ?? 2);
  const note = recs.length ? undefined : recommendationsNote(report);
  if (recs.length) lines.push("", "Recommendations:");
  else if (note) lines.push("", "Recommendations:", note);
  for (const r of recs) {
    lines.push(`• ${fill(r.action)}`);
    lines.push(`  Expected impact: ${fill(`{{${r.impact.low}}}`)} to ${fill(`{{${r.impact.high}}}`)} ${r.impact.horizon}`);
  }
  // Files that were not read are the owner's to fix, so the summary names each one (one line per file).
  const skipped = report.data_quality.filter((i) => FILE_NOT_READ_KINDS.has(i.kind));
  if (skipped.length) lines.push("", "Files not read:");
  for (const i of skipped) lines.push(`• ${fill(i.description)}`);
  if (report.metrics.some((m) => m.status === "assumed"))
    lines.push("", "Note: some metric definitions were assumed, not confirmed. Check them in the report's Metrics section.");
  return lines.join("\n");
}
