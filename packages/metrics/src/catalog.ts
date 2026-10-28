// What a job's workspace holds, as the metric layer sees it: tables, typed columns, date columns.
import { type ColumnType, sql, type Workspace } from "@agentic-analytics/store";

export interface CatalogColumn {
  readonly name: string;
  readonly label: string;
  readonly type: ColumnType;
  readonly currency?: string;
}

/** The year (and month) columns that are the period of a table with no date column (semantics §2.1). */
export interface PeriodParts {
  readonly year: string;
  readonly month?: string;
}

/**
 * The name of the stand-in time column of a table whose period is a year and a month column: it is the table's
 * `dateColumn` (so definitions, validation and merging need no special case) and the compiler reads it as the first day
 * of the month (`timeExpr`).
 */
export const PERIOD_COLUMN = "_period";

export interface CatalogTable {
  readonly name: string; // "t_t1"
  readonly id: string; // "T1"
  readonly label: string; // "sales-2026.xlsx#Orders"
  readonly columns: ReadonlyMap<string, CatalogColumn>;
  /** The table's period column from profiling, if it has a date column, or `PERIOD_COLUMN` when its period is year and month columns. */
  readonly dateColumn?: string;
  readonly periodParts?: PeriodParts;
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
    year_column: string | null;
    month_column: string | null;
  }>(
    sql`SELECT c.table_id, c.name, c.label, c.type, c.currency, f.name AS file, s.sheet, p.date_column,
          pp.year_column, pp.month_column
        FROM table_columns c JOIN sources s ON s.id = c.table_id LEFT JOIN files f ON f.id = s.file_id
        LEFT JOIN profile_tables p ON p.table_id = c.table_id
        LEFT JOIN profile_period_parts pp ON pp.table_id = c.table_id ORDER BY c.table_id, c.position`,
  );
  const tables = new Map<
    string,
    { id: string; label: string; dateColumn?: string; periodParts?: PeriodParts; columns: Map<string, CatalogColumn> }
  >();
  for (const r of rows) {
    const name = `t_${r.table_id.toLowerCase()}`;
    // A table with no date column but a year (and month) column has a period all the same (semantics §2.1).
    const parts =
      !r.date_column && r.year_column ? { year: r.year_column, ...(r.month_column ? { month: r.month_column } : {}) } : undefined;
    const t = tables.get(name) ?? {
      id: r.table_id,
      label: `${r.file ?? r.table_id}${r.sheet ? `#${r.sheet}` : ""}`,
      ...(r.date_column ? { dateColumn: r.date_column } : parts ? { dateColumn: PERIOD_COLUMN, periodParts: parts } : {}),
      columns: new Map<string, CatalogColumn>(),
    };
    t.columns.set(r.name, { name: r.name, label: r.label, type: r.type, ...(r.currency ? { currency: r.currency } : {}) });
    tables.set(name, t);
  }
  for (const t of tables.values()) if (t.periodParts) t.columns.set(PERIOD_COLUMN, { name: PERIOD_COLUMN, label: "Period", type: "date" });
  return new Map([...tables].map(([name, t]) => [name, { name, ...t }]));
}
