// The PROFILE stage (ARCHITECTURE §2): normalize ingested tables, load the workspace, profile every table,
// run the implausibility rules and entity matching, and return the profile summary (`profile.json`) that
// metric drafting reads in M4.
import type { IngestResult } from "@agentic-analytics/ingest";
import { type IssueRow, insertIssues, loadJob, type NormalizedTable, type SectionRow, type Workspace } from "@agentic-analytics/store";
import { ASSUME_BELOW, type Entity, matchEntities } from "./entities.ts";
import { type ColumnIssue, type Grain, normalizeTable } from "./normalize.ts";
import { runRules } from "./rules.ts";
import { profileTable, type TableProfile } from "./stats.ts";

export interface ProfileOptions {
  readonly grain?: Grain;
  /** Today's date (ISO), for the future-date rule. Injected so profiling is deterministic. */
  readonly today: string;
}

export interface ProfileSummary {
  readonly grain: Grain;
  readonly tables: (TableProfile & { file: string; sheet?: string; range: string; name: string })[];
  readonly issues: IssueRow[];
  readonly entities: Entity[];
  /** Things the report must carry as assumptions: unresolved date orders, uncertain entity links. */
  readonly assumptions: { readonly kind: string; readonly text: string; readonly refs: Record<string, unknown> }[];
}

export async function profileJob(ws: Workspace, ingested: IngestResult, options: ProfileOptions): Promise<ProfileSummary> {
  const grain = options.grain ?? "month";
  const fileName = (id: string) => ingested.files.find((f) => f.id === id)?.name ?? id;
  const normalized = ingested.tables.map((t) => ({ region: t, ...normalizeTable(t, grain) }));

  let issueSeq = 0;
  const nextId = () => `Q${++issueSeq}`;
  const issues: IssueRow[] = [];

  // Ingestion issues, attributed to the table whose range holds the cell when there is one.
  for (const i of ingested.issues) {
    const table =
      i.cell && i.sheet
        ? ingested.tables.find((t) => t.file_id === i.file_id && t.sheet === i.sheet && inRange(i.cell ?? "", t.range))
        : undefined;
    issues.push({
      id: nextId(),
      kind: i.kind,
      severity: i.severity,
      message: i.message,
      ...(i.file_id ? { file_id: i.file_id } : {}),
      ...(table ? { source_id: table.id } : {}),
      ...(i.sheet ? { sheet: i.sheet } : {}),
      ...(i.cell ? { cell: i.cell } : {}),
      ...(i.page ? { page: i.page } : {}),
    });
  }
  for (const n of normalized) for (const ci of n.issues) issues.push(columnIssue(nextId(), n.table, ci));

  const emailOf = new Map(ingested.documents_meta.flatMap((m) => (m.email ? [[m.file_id, m.email] as const] : [])));
  const sections: SectionRow[] = ingested.documents.map((d) => {
    const meta = emailOf.get(d.file_id);
    return {
      id: d.id,
      file_id: d.file_id,
      kind: d.kind === "eml" ? "email" : "document",
      ...(d.page !== undefined ? { page: d.page } : {}),
      heading_path: d.heading_path,
      char_start: d.char_start,
      char_end: d.char_end,
      text: d.text,
      // Email headers feed the retrieval chunk prefix (retrieval spec §1).
      ...(meta ? { meta } : {}),
    };
  });
  await loadJob(ws, {
    files: ingested.files.map((f) => ({ ...f, mime: f.mime })),
    tables: normalized.map((n) => n.table),
    sections,
    issues,
  });

  const tables: ProfileSummary["tables"] = [];
  const ruleIssues: IssueRow[] = [];
  for (const n of normalized) {
    const profile = await profileTable(ws, n.table, n.periodColumn);
    tables.push({
      ...profile,
      name: `t_${n.table.id.toLowerCase()}`,
      file: fileName(n.table.file_id),
      ...(n.table.sheet !== undefined ? { sheet: n.table.sheet } : {}),
      range: n.table.range,
    });
    for (const r of await runRules(ws, n.table, profile, options.today)) {
      ruleIssues.push({
        id: nextId(),
        kind: r.kind,
        severity: r.severity,
        message: r.message,
        file_id: n.table.file_id,
        source_id: n.table.id,
        ...(n.table.sheet !== undefined ? { sheet: n.table.sheet } : {}),
        cell: `${r.letter}${r.row}`,
        rows: r.rows ? [...r.rows] : [r.row],
        column_name: r.column,
        details: r.details,
      });
    }
  }
  await insertIssues(ws, ruleIssues);
  const entities = await matchEntities(
    ws,
    normalized.map((n) => n.table),
  );

  const assumptions: ProfileSummary["assumptions"] = [];
  for (const i of issues) {
    const d = i.details as { assumed?: boolean } | undefined;
    if (i.kind === "date_format_ambiguity" && d?.assumed) {
      assumptions.push({
        kind: "date_order",
        text: `Dates in ${i.column_name} of ${fileName(i.file_id ?? "")}${i.sheet ? ` (${i.sheet})` : ""} are read day-first; no value decides the order.`,
        refs: { issue: i.id, source_id: i.source_id },
      });
    }
  }
  for (const e of entities) {
    for (const l of e.links) {
      if (l.confidence < ASSUME_BELOW) {
        assumptions.push({
          kind: "entity_link",
          text: `"${l.raw_value}" is treated as the same ${e.kind} as "${e.canonical_name}".`,
          refs: { entity: e.id, confidence: l.confidence },
        });
      }
    }
  }
  return { grain, tables, issues: [...issues, ...ruleIssues], entities, assumptions };
}

function columnIssue(id: string, t: NormalizedTable, ci: ColumnIssue): IssueRow {
  return {
    id,
    kind: ci.kind,
    severity: ci.severity,
    message: ci.message,
    file_id: t.file_id,
    source_id: t.id,
    ...(t.sheet !== undefined ? { sheet: t.sheet } : {}),
    ...(ci.rows.length === 1 ? { cell: `${ci.letter}${ci.rows[0]}` } : {}),
    rows: ci.rows,
    column_name: ci.column,
    ...(ci.details ? { details: ci.details } : {}),
  };
}

/** Whether an A1 cell lies inside an A1 range like "A1:F7". */
export function inRange(cell: string, range: string): boolean {
  const parse = (a: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(a);
    if (!m) return undefined;
    const col = [...(m[1] ?? "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    return { col, row: Number(m[2]) };
  };
  const [from, to] = range.split(":").map(parse);
  const c = parse(cell);
  if (!c || !from) return false;
  const end = to ?? from;
  return c.col >= from.col && c.col <= end.col && c.row >= from.row && c.row <= end.row;
}
