// What arms A and B are given (docs/specs/accuracy.md §8.1): the job's files read by the engine's own ingest and
// normalisation, so all three arms see the same tables. Arm B gets them as DuckDB tables; arm A gets them as CSV text
// with the documents' text, cut by whole rows to the model's context window minus the prompt, the cut stated.
import { type InputFile, ingest } from "@agentic-analytics/ingest";
import { estimateTokens } from "@agentic-analytics/models";
import { normalizeTable } from "@agentic-analytics/profile";
import { type NormalizedTable, tableName } from "@agentic-analytics/store";
import { AblationError } from "./errors.ts";

export interface SourceDocument {
  readonly file: string;
  readonly text: string;
}

export interface Sources {
  readonly tables: readonly NormalizedTable[];
  readonly documents: readonly SourceDocument[];
  /** The file name of a table's `file_id`. */
  readonly fileOf: (fileId: string) => string;
}

/** Ingests and normalises the files exactly as the engine's ingest and profile stages do (monthly grain). */
export async function readSources(files: readonly InputFile[]): Promise<Sources> {
  const ingested = await ingest(files);
  const names = new Map(ingested.files.map((f) => [f.id, f.name]));
  const fileOf = (id: string) => names.get(id) ?? id;
  const documents = ingested.documents_meta.map((m): SourceDocument => {
    const e = m.email;
    const head = e
      ? [e.from && `From: ${e.from}`, e.to && `To: ${e.to}`, e.date && `Date: ${e.date}`, e.subject && `Subject: ${e.subject}`]
          .filter(Boolean)
          .join("\n")
      : "";
    return { file: fileOf(m.file_id), text: [head, ...m.texts].filter((t) => t.trim()).join("\n\n") };
  });
  return { tables: ingested.tables.map((t) => normalizeTable(t, "month").table), documents, fileOf };
}

/** How much of each table arm A was shown. */
export interface TableCut {
  readonly table: string;
  readonly file: string;
  readonly shown: number;
  readonly of: number;
}

export interface ArmACut {
  /** Every row and document fit. */
  readonly complete: boolean;
  readonly tables: readonly TableCut[];
  /** Documents left out whole because they did not fit. */
  readonly droppedDocuments: readonly string[];
  /** The sentence stated in the input and beside the results. */
  readonly statement: string;
}

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

const where = (t: NormalizedTable, fileOf: (id: string) => string) => `${fileOf(t.file_id)}${t.sheet !== undefined ? `#${t.sheet}` : ""}`;

/**
 * Arm A's data text within `budget` estimated tokens. Documents go first, each whole or left out; then the tables,
 * each cut from the top by whole rows to the same row count k (the largest that fits, found by bisection).
 */
export function armAText(sources: Sources, budget: number): { text: string; cut: ArmACut } {
  if (budget <= 0) throw new AblationError("CONTEXT_TOO_SMALL", "the model's context window can't hold the prompt and any data");
  const parts: string[] = [];
  const dropped: string[] = [];
  let left = budget;
  for (const d of sources.documents) {
    const block = `=== document ${d.file} ===\n${d.text}\n`;
    const cost = estimateTokens(block);
    if (cost <= left) {
      parts.push(block);
      left -= cost;
    } else dropped.push(d.file);
  }
  const tables = sources.tables.map((t) => {
    const header = `=== table ${tableName(t.id)} (${where(t, sources.fileOf)}) ===\n${t.columns.map((c) => csvCell(c.name)).join(",")}\n`;
    const rows = t.rows.map((r) => `${r.values.map(csvCell).join(",")}\n`);
    const prefix = [0];
    for (const r of rows) prefix.push((prefix.at(-1) as number) + estimateTokens(r));
    return { t, header, rows, prefix, headerCost: estimateTokens(header) };
  });
  // Every table shows its first k rows (all of them when it has fewer): the largest k that fits, so small tables
  // stay whole and the large ones are cut to the same number of rows.
  const cost = (k: number) => tables.reduce((s, x) => s + x.headerCost + (x.prefix[Math.min(k, x.rows.length)] as number), 0);
  const most = Math.max(0, ...tables.map((x) => x.rows.length));
  let k = most;
  if (cost(most) > left) {
    let lo = 0;
    let hi = most;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (cost(mid) <= left) lo = mid;
      else hi = mid - 1;
    }
    k = lo;
  }
  const cuts: TableCut[] = [];
  // When not even the tables' header lines fit, no table is shown (and the statement says so).
  for (const x of cost(0) <= left ? tables : []) {
    const shown = Math.min(k, x.rows.length);
    parts.push(x.header + x.rows.slice(0, shown).join(""));
    cuts.push({ table: tableName(x.t.id), file: where(x.t, sources.fileOf), shown, of: x.rows.length });
  }
  const shortTables = cuts.filter((c) => c.shown < c.of);
  const missingTables = tables.length - cuts.length;
  const complete = !shortTables.length && !dropped.length && !missingTables;
  const statement = complete
    ? "The input is complete: every row of every table and every document is shown."
    : `The input is cut to fit the model's context window: ${[
        ...shortTables.map(
          (c) => `${c.table} (${c.file}) ${c.shown ? `shows rows 1–${c.shown} of ${c.of}` : `shows none of its ${c.of} rows`}`,
        ),
        ...(missingTables ? [`${missingTables} table(s) are not shown at all`] : []),
        ...dropped.map((f) => `the document ${f} is left out`),
      ].join("; ")}. Answers about the whole data rest on this sample.`;
  return { text: parts.join("\n"), cut: { complete, tables: cuts, droppedDocuments: dropped, statement } };
}
