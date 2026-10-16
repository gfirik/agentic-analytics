// Column and table profiling (ingestion spec §5), computed in DuckDB and stored in profile_columns/profile_tables.
import { type NormalizedTable, sql, tableName, type Workspace } from "@agentic-analytics/store";
import {
  columnStats,
  dateCoverage,
  duplicateRows,
  madOutliers,
  missingMonths,
  numericCenter,
  tableCounts,
  topValues,
} from "./profile.sql.ts";

const NUMERIC = new Set(["integer", "decimal", "currency", "percent"]);

export interface ColumnProfile {
  readonly name: string;
  readonly label: string;
  readonly type: string;
  readonly currency?: string;
  readonly non_null: number;
  readonly null_pct: number;
  readonly distinct_count: number;
  readonly min_value: string | null;
  readonly max_value: string | null;
  readonly top_values: { value: string; n: number }[];
  readonly median?: number;
  readonly mad?: number;
  readonly outlier_rows: number[];
}

export interface TableProfile {
  readonly table_id: string;
  readonly row_count: number;
  readonly detail_rows: number;
  readonly total_rows: number;
  readonly duplicate_rows: number;
  readonly key_columns: string[];
  readonly key_duplicates: number;
  readonly date_column?: string;
  readonly date_first?: string;
  readonly date_last?: string;
  readonly grain?: "day" | "week" | "month";
  readonly missing_periods: string[];
  readonly columns: ColumnProfile[];
}

export async function profileTable(ws: Workspace, t: NormalizedTable, periodColumn?: string): Promise<TableProfile> {
  const name = tableName(t.id);
  const columns: ColumnProfile[] = [];
  for (const c of t.columns) {
    const s = await ws.one<{ n: number; non_null: number; distinct_count: number; min_value: string | null; max_value: string | null }>(
      columnStats(name, c.name),
    );
    const top = await ws.all<{ value: string; n: number }>(topValues(name, c.name));
    let center: { median: number | null; mad: number | null } | undefined;
    let outliers: number[] = [];
    if (NUMERIC.has(c.type)) {
      center = await ws.one<{ median: number | null; mad: number | null }>(numericCenter(name, c.name));
      if (center?.median !== null && center?.median !== undefined && center.mad) {
        outliers = (await ws.all<{ _row: number }>(madOutliers(name, c.name, center.median, center.mad))).map((r) => r._row);
      }
    }
    const n = s?.n ?? 0;
    const profile: ColumnProfile = {
      name: c.name,
      label: c.label,
      type: c.type,
      ...(c.currency ? { currency: c.currency } : {}),
      non_null: s?.non_null ?? 0,
      null_pct: n ? ((n - (s?.non_null ?? 0)) / n) * 100 : 0,
      distinct_count: s?.distinct_count ?? 0,
      min_value: s?.min_value ?? null,
      max_value: s?.max_value ?? null,
      top_values: top,
      ...(center?.median !== null && center?.median !== undefined ? { median: center.median } : {}),
      ...(center?.mad !== null && center?.mad !== undefined ? { mad: center.mad } : {}),
      outlier_rows: outliers,
    };
    columns.push(profile);
    await ws.run(sql`INSERT INTO profile_columns VALUES (${t.id}, ${c.name}, ${c.type}, ${profile.non_null}, ${profile.null_pct}, ${profile.distinct_count},
      ${profile.min_value}, ${profile.max_value}, ${JSON.stringify(top)}::JSON, ${profile.median ?? null}, ${profile.mad ?? null}, ${JSON.stringify(outliers)}::INTEGER[])`);
  }

  const counts = await ws.one<{ row_count: number; detail_rows: number; total_rows: number }>(tableCounts(name));
  const dataCols = t.columns.map((c) => c.name);
  const duplicates = dataCols.length ? ((await ws.one<{ duplicates: number }>(duplicateRows(name, dataCols)))?.duplicates ?? 0) : 0;
  // Inferred key: id-typed columns (e.g. an order id); an id-like column that repeats points at duplicates.
  const keyColumns = t.columns.filter((c) => c.type === "id").map((c) => c.name);
  const keyDuplicates = keyColumns.length ? ((await ws.one<{ duplicates: number }>(duplicateRows(name, keyColumns)))?.duplicates ?? 0) : 0;

  let coverage: Partial<TableProfile> = { missing_periods: [] };
  if (periodColumn) {
    const cov = await ws.one<{
      first: string | null;
      last: string | null;
      days: number;
      weeks: number;
      months: number;
      not_first_of_month: number;
      weekdays: number;
    }>(dateCoverage(name, periodColumn));
    if (cov?.first && cov.last) {
      // The data's own grain: one date per month on the 1st → month; dates all on one weekday → week; else day.
      const grain = cov.days === cov.months && cov.not_first_of_month === 0 ? "month" : cov.days > 1 && cov.weekdays === 1 ? "week" : "day";
      const missing = (await ws.all<{ p: string }>(missingMonths(name, periodColumn, cov.first, cov.last))).map((r) => r.p);
      coverage = { date_column: periodColumn, date_first: cov.first, date_last: cov.last, grain, missing_periods: missing };
    }
  }

  const profile: TableProfile = {
    table_id: t.id,
    row_count: counts?.row_count ?? 0,
    detail_rows: counts?.detail_rows ?? 0,
    total_rows: counts?.total_rows ?? 0,
    duplicate_rows: duplicates,
    key_columns: keyColumns,
    key_duplicates: keyDuplicates,
    missing_periods: [],
    ...coverage,
    columns,
  };
  await ws.run(sql`INSERT INTO profile_tables VALUES (${t.id}, ${profile.row_count}, ${profile.detail_rows}, ${profile.total_rows}, ${profile.duplicate_rows},
    ${JSON.stringify(keyColumns)}::VARCHAR[], ${keyDuplicates}, ${profile.date_column ?? null}, ${profile.date_first ?? null}::DATE, ${profile.date_last ?? null}::DATE,
    ${profile.grain ?? null}, ${JSON.stringify(profile.missing_periods)}::VARCHAR[])`);
  return profile;
}
