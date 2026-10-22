// Arm B's DuckDB (docs/specs/accuracy.md §8.2). Arm B runs model-written SQL, which AGENTS.md §2.6 forbids in the
// engine, so the database is fenced in:
// - built per run in two phases: a writable instance loads the ingested source tables only and is closed, then the
//   file is reopened locked (read-only, no file or network access, no extensions, bounded memory, threads and spill);
// - every statement has a timeout (a timer calls `connection.interrupt()`, DuckDB has none of its own);
// - results are read chunk by chunk with running row and byte counts and stopped at the cap, because they go back
//   into the model's prompt;
// - a refused or stopped statement is a typed AblationError, which run_sql returns as a tool error.

import { DUCKDB_TYPE, ident, type NormalizedTable, tableName } from "@agentic-analytics/store";
import { type DuckDBConnection, DuckDBInstance, type DuckDBValue } from "@duckdb/node-api";
import { AblationError } from "./errors.ts";

export interface SandboxLimits {
  /** DuckDB's memory limit for the locked instance (AGENTS §9). */
  readonly memoryLimit: string;
  readonly threads: number;
  /** The most the per-run temp directory may hold when a statement spills. */
  readonly maxTempDirectorySize: string;
  /** Per statement. */
  readonly timeoutMs: number;
  /** The most rows and bytes (as JSON) a result may have; past either, the statement is stopped. */
  readonly maxRows: number;
  readonly maxBytes: number;
}

export const DEFAULT_LIMITS: SandboxLimits = {
  memoryLimit: "1GB",
  threads: 2,
  maxTempDirectorySize: "1GB",
  timeoutMs: 10_000,
  maxRows: 200,
  maxBytes: 32_768,
};

/**
 * The nine options of the locked open, in the order they are applied (m14.md item 6, checked on @duckdb/node-api
 * 1.5.6): `temp_directory` before `enable_external_access=false` (after it, the open fails with "Failed to set
 * config"), and `lock_configuration` last.
 */
export const LOCKED_OPTION_NAMES = [
  "temp_directory",
  "max_temp_directory_size",
  "access_mode",
  "enable_external_access",
  "autoinstall_known_extensions",
  "autoload_known_extensions",
  "memory_limit",
  "threads",
  "lock_configuration",
] as const;
export type LockedOption = (typeof LOCKED_OPTION_NAMES)[number];

/** The nine options' values for a per-run temp directory, in LOCKED_OPTION_NAMES order. */
export function lockedOptions(tempDir: string, limits: SandboxLimits = DEFAULT_LIMITS): Record<LockedOption, string> {
  return {
    temp_directory: tempDir,
    max_temp_directory_size: limits.maxTempDirectorySize,
    access_mode: "READ_ONLY",
    enable_external_access: "false",
    autoinstall_known_extensions: "false",
    autoload_known_extensions: "false",
    memory_limit: limits.memoryLimit,
    threads: String(limits.threads),
    lock_configuration: "true",
  };
}

/** A table as arm B sees it: its SQL name, where it came from, and its columns (`_row`, `_is_total`, `_period` first). */
export interface TableInfo {
  readonly name: string;
  readonly file: string;
  readonly sheet?: string;
  readonly rows: number;
  readonly columns: readonly { readonly name: string; readonly label: string; readonly type: string }[];
}

/**
 * Phase 1: a writable instance loads the ingested source tables, and nothing else (no metric definitions, facts or
 * document chunks from the engine's workspace), then is closed. Returns the tables it created.
 */
export async function buildSourceDatabase(
  path: string,
  tables: readonly NormalizedTable[],
  fileOf: (fileId: string) => string,
  limits: SandboxLimits = DEFAULT_LIMITS,
): Promise<TableInfo[]> {
  const instance = await DuckDBInstance.create(path, { memory_limit: limits.memoryLimit, threads: String(limits.threads) });
  const out: TableInfo[] = [];
  try {
    const conn = await instance.connect();
    try {
      for (const t of tables) {
        const name = tableName(t.id);
        const columns = t.columns.map((c) => `${ident(c.name).quoted} ${DUCKDB_TYPE[c.type]}`).join(", ");
        // Built only from checked identifiers and a fixed type map, as the store builds them.
        await conn.run(
          `CREATE TABLE ${ident(name).quoted} (_row INTEGER NOT NULL, _is_total BOOLEAN NOT NULL, _period VARCHAR${columns ? `, ${columns}` : ""})`,
        );
        const appender = await conn.createAppender(name);
        try {
          for (const r of t.rows) {
            appender.appendInteger(r.row);
            appender.appendBoolean(r.is_total);
            if (r.period === null) appender.appendNull();
            else appender.appendVarchar(r.period);
            for (const v of r.values) {
              if (v === null || (typeof v === "number" && !Number.isFinite(v))) appender.appendNull();
              else if (typeof v === "number") appender.appendDouble(v);
              else if (typeof v === "boolean") appender.appendBoolean(v);
              else appender.appendVarchar(v);
            }
            appender.endRow();
          }
          appender.flushSync();
        } finally {
          appender.closeSync();
        }
        out.push({
          name,
          file: fileOf(t.file_id),
          ...(t.sheet !== undefined ? { sheet: t.sheet } : {}),
          rows: t.rows.length,
          columns: [
            { name: "_row", label: "source row number", type: "INTEGER" },
            { name: "_is_total", label: "true on a totals row", type: "BOOLEAN" },
            { name: "_period", label: "the row's month (YYYY-MM)", type: "VARCHAR" },
            ...t.columns.map((c) => ({ name: c.name, label: c.label, type: DUCKDB_TYPE[c.type] })),
          ],
        });
      }
    } finally {
      conn.closeSync();
    }
  } finally {
    instance.closeSync();
  }
  return out;
}

export interface SqlResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly SqlCell[])[];
}
export type SqlCell = string | number | boolean | null;

/** Phase 2: the file reopened locked. One connection, one statement at a time. */
export class SqlSandbox {
  private closed = false;

  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly conn: DuckDBConnection,
    readonly limits: SandboxLimits,
  ) {}

  /**
   * Opens `path` locked, spilling to `tempDir`. The nine options are applied in LOCKED_OPTION_NAMES order. DuckDB
   * 1.5.6 reads `max_temp_directory_size` back from the open's options but does not enforce it (a sort spilled 87 MB
   * past a 1 MB cap); the same value set by `SET` is enforced. So the open passes the first eight options, sets
   * `max_temp_directory_size` again, then sets `lock_configuration` last, before any model-written statement runs.
   */
  static async open(path: string, tempDir: string, limits: SandboxLimits = DEFAULT_LIMITS): Promise<SqlSandbox> {
    const { lock_configuration: _lock, ...eight } = lockedOptions(tempDir, limits);
    const instance = await DuckDBInstance.create(path, eight);
    let conn: DuckDBConnection | undefined;
    try {
      conn = await instance.connect();
      await conn.run(`SET max_temp_directory_size = '${quoteSetting(limits.maxTempDirectorySize)}'`);
      await conn.run("SET lock_configuration = true");
      return new SqlSandbox(instance, conn, limits);
    } catch (err) {
      conn?.closeSync();
      instance.closeSync();
      throw err;
    }
  }

  /** `current_setting` of each of the nine options, as DuckDB reports it (for the read-back test). */
  async settings(): Promise<Record<LockedOption, unknown>> {
    const out: Partial<Record<LockedOption, unknown>> = {};
    for (const name of LOCKED_OPTION_NAMES) {
      const r = await this.conn.runAndReadAll(`SELECT current_setting('${name}') AS v`);
      out[name] = r.getRowObjectsJS()[0]?.v;
    }
    return out as Record<LockedOption, unknown>;
  }

  /**
   * Runs one model-written statement under the timeout and the row and byte caps. Throws a typed AblationError
   * (SQL_REFUSED, SQL_TIMEOUT, SQL_OUT_OF_MEMORY, SQL_OUT_OF_SPACE, RESULT_TOO_LARGE, SQL_ERROR).
   */
  async run(text: string): Promise<SqlResult> {
    if (this.closed) throw new AblationError("USAGE", "the sandbox is closed");
    const { timeoutMs, maxRows, maxBytes } = this.limits;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      this.conn.interrupt();
    }, timeoutMs);
    try {
      const result = await this.conn.stream(text);
      const columns = result.columnNames();
      const rows: SqlCell[][] = [];
      let bytes = JSON.stringify(columns).length;
      for (;;) {
        const chunk = await result.fetchChunk();
        if (!chunk || chunk.rowCount === 0) break;
        for (const raw of chunk.getRows()) {
          const row = raw.map(cell);
          bytes += JSON.stringify(row).length + 1;
          if (rows.length + 1 > maxRows)
            throw new AblationError("RESULT_TOO_LARGE", `the result has more than ${maxRows} rows; aggregate it or add a LIMIT`);
          if (bytes > maxBytes)
            throw new AblationError("RESULT_TOO_LARGE", `the result is over ${maxBytes} bytes; select fewer columns or rows`);
          rows.push(row);
        }
      }
      return { columns, rows };
    } catch (err) {
      if (err instanceof AblationError) throw err;
      throw classify(err, timedOut, timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.conn.closeSync();
    this.instance.closeSync();
  }
}

/** A DuckDB value as plain JSON for the model's prompt: big integers as numbers when they fit, others as text. */
function cell(v: DuckDBValue): SqlCell {
  if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number") return v;
  if (typeof v === "bigint") return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
  return String(v);
}

/** A setting's value inside single quotes: only sizes like "1GB" are passed, but quotes are doubled anyway. */
const quoteSetting = (v: string) => v.replaceAll("'", "''");

/** DuckDB's error, as the typed code arm B's tool error carries. */
export function classify(err: unknown, timedOut: boolean, timeoutMs: number): AblationError {
  const message = (err instanceof Error ? err.message : String(err)).split("\n")[0]?.slice(0, 300) ?? "";
  if (timedOut || /^INTERRUPT|Interrupted/.test(message))
    return new AblationError("SQL_TIMEOUT", `the statement ran past ${timeoutMs} ms and was stopped`, { cause: err });
  // Spilling past max_temp_directory_size surfaces as an out-of-memory error about offloading a block.
  if (/failed to offload|max_temp_directory_size|temporary director/i.test(message))
    return new AblationError("SQL_OUT_OF_SPACE", `the statement needs more temporary space than allowed: ${message}`, { cause: err });
  if (/Out of Memory/i.test(message))
    return new AblationError("SQL_OUT_OF_MEMORY", `the statement needs more memory than allowed: ${message}`, { cause: err });
  if (/Permission Error|disabled (by|through) configuration|configuration has been locked|read-only mode/i.test(message))
    return new AblationError("SQL_REFUSED", `refused: ${message}`, { cause: err });
  return new AblationError("SQL_ERROR", message, { cause: err });
}
