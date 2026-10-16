// Writes one job's ingested and normalized data into the workspace (ARCHITECTURE §3): files, sources,
// one typed `t_<id>` table per source table (with `_row`, `_is_total`, `_period`), and quality issues.
import { ident, idents, sql } from "./sql.ts";
import { DUCKDB_TYPE, type IssueRow, type LoadInput, type NormalizedTable, tableName } from "./types.ts";
import type { Workspace } from "./workspace.ts";

const arr = (xs: readonly (string | number)[]) => JSON.stringify(xs);

export async function loadJob(ws: Workspace, input: LoadInput): Promise<void> {
  for (const f of input.files) {
    await ws.run(
      sql`INSERT INTO files VALUES (${f.id}, ${f.name}, ${f.sha256}, ${f.mime}, ${f.kind}, ${f.size}, ${f.status}, ${f.duplicate_of ?? null}, ${f.parent ?? null})`,
    );
  }
  for (const t of input.tables) await loadTable(ws, t);
  for (const s of input.sections) {
    await ws.run(sql`INSERT INTO sources (id, file_id, kind, external, page, section, char_start, char_end, text)
      VALUES (${s.id}, ${s.file_id}, ${s.kind}, false, ${s.page ?? null}, ${arr(s.heading_path)}::VARCHAR[], ${s.char_start}, ${s.char_end}, ${s.text})`);
  }
  await insertIssues(ws, input.issues);
}

export async function loadTable(ws: Workspace, t: NormalizedTable): Promise<void> {
  await ws.run(sql`INSERT INTO sources (id, file_id, kind, external, table_id, sheet, range_a1, hidden_sheet, header_rows, notes, transposed)
    VALUES (${t.id}, ${t.file_id}, 'table', false, ${tableName(t.id)}, ${t.sheet ?? null}, ${t.range}, ${t.hidden_sheet},
      ${arr(t.header_rows)}::INTEGER[], ${arr(t.notes)}::VARCHAR[], ${t.transposed})`);
  for (const [i, c] of t.columns.entries()) {
    await ws.run(
      sql`INSERT INTO table_columns VALUES (${t.id}, ${i}, ${c.name}, ${c.label}, ${c.letter}, ${c.type}, ${c.currency ?? null})`,
    );
  }
  const name = tableName(t.id);
  const columns = t.columns.map((c) => `${ident(c.name).quoted} ${DUCKDB_TYPE[c.type]}`).join(", ");
  // Column definitions are built only from checked identifiers and a fixed type map.
  await ws.run({
    text: `CREATE TABLE ${ident(name).quoted} (_row INTEGER NOT NULL, _is_total BOOLEAN NOT NULL, _period VARCHAR${columns ? `, ${columns}` : ""})`,
    params: [],
  });
  await ws.append(
    name,
    t.rows.map((r) => [r.row, r.is_total, r.period, ...r.values.map((v) => (typeof v === "number" && !Number.isFinite(v) ? null : v))]),
  );
}

export async function insertIssues(ws: Workspace, issues: readonly IssueRow[]): Promise<void> {
  for (const q of issues) {
    await ws.run(sql`INSERT INTO quality_issues VALUES (${q.id}, ${q.kind}, ${q.severity}, ${q.message}, ${q.file_id ?? null}, ${q.source_id ?? null},
      ${q.sheet ?? null}, ${q.cell ?? null}, ${q.rows ? arr(q.rows) : null}::INTEGER[], ${q.page ?? null}, ${q.column_name ?? null},
      ${q.details === undefined ? null : JSON.stringify(q.details)}::JSON)`);
  }
}

/** Column list helper for callers that select a table's data columns. */
export function dataColumns(t: NormalizedTable) {
  return idents(t.columns.map((c) => c.name));
}
