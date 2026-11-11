// Plain-text views of a verified report for chat-like doors (MCP, Telegram, the CLI): placeholders are filled with
// the formatted fact values, never with recomputed numbers. Interfaces §3–§4.
import type { Fact, Report } from "@agentic-analytics/schema";
import { formatFact } from "./format.ts";

/** Replaces each `{{N…}}` with its fact's formatted value (an unknown id stays as written). */
export function fillPlaceholders(text: string, facts: ReadonlyMap<string, Fact> | readonly Fact[]): string {
  const byId = facts instanceof Map ? facts : new Map((facts as readonly Fact[]).map((f) => [f.id, f]));
  return text.replace(/\{\{(N\d+)\}\}/g, (m, id: string) => {
    const f = byId.get(id);
    return f ? formatFact(f) : m;
  });
}

/** Data-quality kinds that mean a whole file was skipped (ingestion spec §1). */
const FILE_NOT_READ: ReadonlySet<string> = new Set([
  "archive_rejected",
  "unsupported_type",
  "unreadable_file",
  "password_protected",
  "too_large",
]);

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
  const findings = report.findings.slice(0, o.findings ?? 3);
  if (findings.length) lines.push("Findings:");
  for (const f of findings) {
    lines.push(`• ${fill(f.title)}`);
    const c = f.claims[0];
    if (c) lines.push(`  ${fill(c.text)}`);
  }
  const recs = report.recommendations.slice(0, o.recommendations ?? 2);
  if (recs.length) lines.push("", "Recommendations:");
  for (const r of recs) {
    lines.push(`• ${fill(r.action)}`);
    lines.push(`  Expected impact: ${fill(`{{${r.impact.low}}}`)} to ${fill(`{{${r.impact.high}}}`)} ${r.impact.horizon}`);
  }
  // Files that were not read are the owner's to fix, so the summary names each one (one line per file).
  const skipped = report.data_quality.filter((i) => FILE_NOT_READ.has(i.kind));
  if (skipped.length) lines.push("", "Files not read:");
  for (const i of skipped) lines.push(`• ${fill(i.description)}`);
  if (report.metrics.some((m) => m.status === "assumed"))
    lines.push("", "Note: some metric definitions were assumed, not confirmed. Check them in the report's Metrics section.");
  return lines.join("\n");
}
