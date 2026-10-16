// Evidence excerpts for the self-contained report (report-schema, additive `evidence` field): the cited table
// rows and the passages around cited quotes, copied from the sources, so the HTML report can show and highlight
// what a citation points at offline. Values are copied, never computed.
import type { Citation, Evidence, Report } from "@agentic-analytics/schema";
import { ident, sql, tableName, type Workspace } from "@agentic-analytics/store";

/** At most this many cited rows per table are copied (the rest stay in the source file). */
export const MAX_EVIDENCE_ROWS = 120;
/** Rows copied per citation, so every citation has some of its rows to highlight. */
const ROWS_PER_CITATION = 5;
const CONTEXT_CHARS = 300;
const WHOLE_TEXT_UNDER = 1500;

function citationsOf(report: Report): Citation[] {
  return [
    ...report.summary.bullets.flatMap((c) => c.citations),
    ...report.findings.flatMap((f) => f.claims.flatMap((c) => c.citations)),
    ...report.recommendations.flatMap((r) => r.rationale.flatMap((c) => c.citations)),
    ...report.facts.flatMap((f) => f.citations),
    ...report.data_quality.flatMap((q) => q.citations),
  ];
}

const cellValue = (v: unknown): string | number | null =>
  v === null || v === undefined
    ? null
    : typeof v === "number"
      ? v
      : typeof v === "string"
        ? /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(v)
          ? v.slice(0, 10)
          : v
        : String(v);

export async function buildEvidence(ws: Workspace, report: Report): Promise<Evidence[]> {
  const rows = new Map<string, number[]>();
  const quotes = new Map<string, Set<string>>();
  const cited = new Set<string>();
  for (const c of citationsOf(report)) {
    cited.add(c.source_id);
    if (c.rows?.length) {
      const list = rows.get(c.source_id) ?? [];
      for (const r of c.rows.slice(0, ROWS_PER_CITATION)) if (list.length < MAX_EVIDENCE_ROWS && !list.includes(r)) list.push(r);
      rows.set(c.source_id, list);
    }
    if (c.quote) quotes.set(c.source_id, new Set([...(quotes.get(c.source_id) ?? []), c.quote]));
  }
  const sources = await ws.all<{
    id: string;
    kind: string;
    page: number | null;
    section: string[] | null;
    char_start: number | null;
    text: string | null;
  }>(sql`SELECT id, kind, page, section, char_start, text FROM sources ORDER BY id`);
  // A quarantined source is cited by its data-quality item, but its text is untrusted and never copied into the
  // report (security §3: quarantine applies to the whole source); the report says that it was flagged, not what.
  const quarantined = new Set((await ws.all<{ source_id: string }>(sql`SELECT source_id FROM quarantine`)).map((r) => r.source_id));
  const out: Evidence[] = [];
  for (const s of sources.filter((x) => cited.has(x.id) && !quarantined.has(x.id))) {
    if (s.kind === "table") {
      const wanted = [...(rows.get(s.id) ?? [])].sort((a, b) => a - b);
      if (!wanted.length) continue;
      const cols = await ws.all<{ name: string; label: string; letter: string | null; position: number }>(
        sql`SELECT name, label, letter, position FROM table_columns WHERE table_id = ${s.id} ORDER BY position`,
      );
      const found = await ws.all(
        sql`SELECT * FROM ${ident(tableName(s.id))} WHERE list_contains(${JSON.stringify(wanted)}::INTEGER[], _row) ORDER BY _row`,
      );
      out.push({
        source_id: s.id,
        kind: "table",
        columns: cols.map((c, i) => ({ letter: c.letter ?? String.fromCharCode(65 + i), name: c.label })),
        rows: found.map((r) => ({ row: Number(r._row), cells: cols.map((c) => cellValue(r[c.name])) })),
      });
      continue;
    }
    const text = s.text ?? "";
    if (!text) continue;
    const qs = [...(quotes.get(s.id) ?? [])].map((q) => [text.indexOf(q), q.length] as const).filter(([i]) => i >= 0);
    let from = 0;
    let to = text.length;
    if (text.length > WHOLE_TEXT_UNDER) {
      if (qs.length) {
        from = Math.max(0, Math.min(...qs.map(([i]) => i)) - CONTEXT_CHARS);
        to = Math.min(text.length, Math.max(...qs.map(([i, n]) => i + n)) + CONTEXT_CHARS);
      } else to = Math.min(text.length, 2 * CONTEXT_CHARS);
    }
    out.push({
      source_id: s.id,
      kind: "text",
      ...(s.page ? { page: s.page } : {}),
      ...(s.section?.length ? { section: s.section.join(" › ") } : {}),
      char_start: (s.char_start ?? 0) + from,
      text: text.slice(from, to),
    });
  }
  return out;
}
