// What a job's workspace holds, as the metric layer sees it: tables, typed columns, date columns.
import { type ColumnType, sql, type Workspace } from "@agentic-analytics/store";

export interface CatalogColumn {
  readonly name: string;
  readonly label: string;
  readonly type: ColumnType;
  readonly currency?: string;
}

export interface CatalogTable {
  readonly name: string; // "t_t1"
  readonly id: string; // "T1"
  readonly label: string; // "sales-2026.xlsx#Orders"
  readonly columns: ReadonlyMap<string, CatalogColumn>;
  /** The table's period column from profiling, if it has a date column. */
  readonly dateColumn?: string;
}

export type Catalog = ReadonlyMap<string, CatalogTable>;

export const NUMERIC_TYPES: ReadonlySet<ColumnType> = new Set(["integer", "decimal", "currency", "percent"]);
export const DATE_TYPES: ReadonlySet<ColumnType> = new Set(["date", "datetime"]);
export const DIMENSION_TYPES: ReadonlySet<ColumnType> = new Set(["category", "text", "id", "boolean", "date"]);

export async function loadCatalog(ws: Workspace): Promise<Catalog> {
  const rows = await ws.all<{
    table_id: string;
    name: string;
    label: string;
    type: ColumnType;
    currency: string | null;
    file: string;
    sheet: string | null;
    date_column: string | null;
  }>(
    sql`SELECT c.table_id, c.name, c.label, c.type, c.currency, f.name AS file, s.sheet, p.date_column
        FROM table_columns c JOIN sources s ON s.id = c.table_id LEFT JOIN files f ON f.id = s.file_id
        LEFT JOIN profile_tables p ON p.table_id = c.table_id ORDER BY c.table_id, c.position`,
  );
  const tables = new Map<string, { id: string; label: string; dateColumn?: string; columns: Map<string, CatalogColumn> }>();
  for (const r of rows) {
    const name = `t_${r.table_id.toLowerCase()}`;
    const t = tables.get(name) ?? {
      id: r.table_id,
      label: `${r.file ?? r.table_id}${r.sheet ? `#${r.sheet}` : ""}`,
      ...(r.date_column ? { dateColumn: r.date_column } : {}),
      columns: new Map<string, CatalogColumn>(),
    };
    t.columns.set(r.name, { name: r.name, label: r.label, type: r.type, ...(r.currency ? { currency: r.currency } : {}) });
    tables.set(name, t);
  }
  return new Map([...tables].map(([name, t]) => [name, { name, ...t }]));
}
