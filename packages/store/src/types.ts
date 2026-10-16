// What the store loads. These shapes are owned here (store is the bottom layer); `packages/profile`
// converts ingestion output into them.

export type ColumnType = "date" | "datetime" | "integer" | "decimal" | "currency" | "percent" | "boolean" | "category" | "id" | "text";

export const DUCKDB_TYPE: Record<ColumnType, string> = {
  date: "DATE",
  datetime: "TIMESTAMP",
  integer: "BIGINT",
  decimal: "DOUBLE",
  currency: "DOUBLE",
  percent: "DOUBLE",
  boolean: "BOOLEAN",
  category: "VARCHAR",
  id: "VARCHAR",
  text: "VARCHAR",
};

export interface NormalizedColumn {
  /** snake_case SQL name, unique within the table. */
  readonly name: string;
  /** The original header text. */
  readonly label: string;
  readonly letter: string;
  readonly type: ColumnType;
  readonly currency?: string;
}

export type NormalizedValue = string | number | boolean | null;

export interface NormalizedRow {
  readonly row: number; // `_row`: original sheet row number
  readonly is_total: boolean;
  readonly period: string | null; // `_period` at the job grain
  readonly values: readonly NormalizedValue[];
}

export interface NormalizedTable {
  readonly id: string; // "T1" → table t_t1
  readonly file_id: string;
  readonly sheet?: string;
  readonly range: string;
  readonly hidden_sheet: boolean;
  readonly header_rows: readonly number[];
  readonly notes: readonly string[];
  readonly transposed: boolean;
  readonly columns: readonly NormalizedColumn[];
  readonly rows: readonly NormalizedRow[];
}

export interface FileRow {
  readonly id: string;
  readonly name: string;
  readonly sha256: string;
  readonly mime: string;
  readonly kind: string;
  readonly size: number;
  readonly status: string;
  readonly duplicate_of?: string;
  readonly parent?: string;
}

export interface SectionRow {
  readonly id: string; // "D1"
  readonly file_id: string;
  readonly kind: "document" | "email";
  readonly page?: number;
  readonly heading_path: readonly string[];
  readonly char_start: number;
  readonly char_end: number;
  readonly text: string;
  /** Email headers for email sections. */
  readonly meta?: { readonly from?: string; readonly to?: string; readonly date?: string; readonly subject?: string };
}

export interface IssueRow {
  readonly id: string; // "Q1"
  readonly kind: string;
  readonly severity: "high" | "medium" | "low";
  readonly message: string;
  readonly file_id?: string;
  readonly source_id?: string;
  readonly sheet?: string;
  readonly cell?: string;
  readonly rows?: readonly number[];
  readonly page?: number;
  readonly column_name?: string;
  readonly details?: unknown;
}

export interface LoadInput {
  readonly files: readonly FileRow[];
  readonly tables: readonly NormalizedTable[];
  readonly sections: readonly SectionRow[];
  readonly issues: readonly IssueRow[];
}

/** DuckDB table name for a source table id ("T1" → "t_t1"). */
export function tableName(id: string): string {
  return `t_${id.toLowerCase()}`;
}
