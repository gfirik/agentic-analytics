// The ingestion output contract (docs/plans/m2.md). M3 loads these into the job's DuckDB workspace.

export type FileKind = "xlsx" | "xls" | "csv" | "tsv" | "pdf" | "docx" | "eml" | "txt" | "md";

export interface InputFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface FileRecord {
  readonly id: string; // "F1"
  readonly name: string;
  readonly sha256: string;
  readonly size: number;
  readonly kind: FileKind | "unknown";
  readonly mime: string;
  readonly status: "ingested" | "duplicate" | "rejected" | "failed";
  readonly duplicate_of?: string;
  /** For email attachments: the file id of the email. */
  readonly parent?: string;
}

export type CellType = "s" | "n" | "b" | "d" | "e";

export interface Cell {
  /** Strings, numbers, booleans; dates as ISO strings (`2026-03-01` or `2026-03-01T09:30:00`); errors as their text. */
  readonly v: string | number | boolean | null;
  readonly t: CellType | "z";
  readonly f?: string; // formula text, never evaluated
  readonly z?: string; // number format
}

export interface TableColumn {
  readonly name: string;
  readonly letter: string; // sheet column of the values ("" for pivoted columns)
}

export interface TableRow {
  /** 1-based sheet row number (`_row` in DuckDB). */
  readonly row: number;
  readonly cells: readonly Cell[];
  readonly is_total: boolean;
  /** A1 refs of each cell, only for pivoted (transposed) tables where they don't follow from row + letter. */
  readonly refs?: readonly string[];
}

export interface TableRegion {
  readonly id: string; // "T1"
  readonly file_id: string;
  readonly sheet?: string;
  readonly hidden_sheet: boolean;
  /** A1 range of header + data (notes excluded). */
  readonly range: string;
  readonly header_rows: readonly number[];
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
  readonly transposed: boolean;
  readonly notes: readonly string[];
}

export interface DocumentSection {
  readonly id: string; // "D1"
  readonly file_id: string;
  readonly kind: "pdf" | "docx" | "eml" | "txt" | "md";
  readonly page?: number;
  readonly heading_path: readonly string[];
  /** Offsets into the page text (PDF) or the whole document text (others). */
  readonly char_start: number;
  readonly char_end: number;
  readonly text: string;
}

export interface DocumentMeta {
  readonly file_id: string;
  readonly kind: DocumentSection["kind"];
  readonly pages?: number;
  /** The extracted text the offsets refer to: one entry per page for PDFs, else one entry. */
  readonly texts: readonly string[];
  readonly email?: { readonly from?: string; readonly to?: string; readonly date?: string; readonly subject?: string };
  readonly via?: "unpdf" | "docling" | "mammoth" | "mailparser" | "text";
}

export type IngestIssueKind =
  | "unreadable_file"
  | "password_protected"
  | "unsupported_type"
  | "archive_rejected"
  | "too_large"
  | "too_many_files"
  | "duplicate_file"
  | "missing_cached_value"
  | "needs_ocr"
  | "hidden_sheet"
  | "too_many_cells"
  | "no_tables_found";

export interface IngestIssue {
  readonly kind: IngestIssueKind;
  readonly severity: "high" | "medium" | "low";
  readonly file_id?: string;
  readonly file: string;
  /** Developer-facing detail; reports render their own wording (free-numeral rule, report-schema §3). */
  readonly message: string;
  readonly sheet?: string;
  readonly cell?: string;
  readonly page?: number;
}

export interface IngestResult {
  readonly files: FileRecord[];
  readonly tables: TableRegion[];
  readonly documents: DocumentSection[];
  readonly documents_meta: DocumentMeta[];
  readonly issues: IngestIssue[];
}
