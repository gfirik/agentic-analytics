// One DuckDB file per job (DECISIONS D2). The workspace owns the connection and runs migrations on open.
import { type DuckDBConnection, DuckDBInstance, type DuckDBValue } from "@duckdb/node-api";
import { StoreError } from "./errors.ts";
import { MIGRATIONS } from "./migrations.sql.ts";
import { type Sql, sql } from "./sql.ts";

export type Row = Record<string, unknown>;

export class Workspace {
  private closed = false;

  private constructor(
    private readonly instance: DuckDBInstance,
    readonly connection: DuckDBConnection,
    readonly path: string,
  ) {}

  /** Opens (or creates) a job workspace and brings its schema up to date. */
  static async open(path = ":memory:"): Promise<Workspace> {
    const instance = await DuckDBInstance.create(path);
    const ws = new Workspace(instance, await instance.connect(), path);
    try {
      await ws.migrate();
    } catch (err) {
      // A bad or newer workspace file: release the database before failing, or the process keeps its lock.
      ws.close();
      throw err;
    }
    return ws;
  }

  async run(q: Sql): Promise<void> {
    this.check();
    try {
      await this.connection.run(q.text, q.params as DuckDBValue[]);
    } catch (err) {
      throw new StoreError("QUERY", `${err instanceof Error ? err.message : String(err)}\n  in: ${q.text.slice(0, 200)}`, { cause: err });
    }
  }

  /** Rows as plain objects; BIGINTs become numbers when they fit, dates become ISO strings. */
  async all<T extends Row = Row>(q: Sql): Promise<T[]> {
    this.check();
    try {
      const reader = await this.connection.runAndReadAll(q.text, q.params as DuckDBValue[]);
      return reader.getRowObjectsJS().map((r) => normalizeRow(r) as T);
    } catch (err) {
      throw new StoreError("QUERY", `${err instanceof Error ? err.message : String(err)}\n  in: ${q.text.slice(0, 200)}`, { cause: err });
    }
  }

  async one<T extends Row = Row>(q: Sql): Promise<T | undefined> {
    return (await this.all<T>(q))[0];
  }

  /** Bulk insert through DuckDB's appender; values are cast by DuckDB from their text form. */
  async append(table: string, rows: readonly (readonly (string | number | boolean | null)[])[]): Promise<void> {
    this.check();
    const appender = await this.connection.createAppender(table);
    try {
      for (const row of rows) {
        for (const v of row) {
          if (v === null) appender.appendNull();
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
  }

  async version(): Promise<number> {
    const row = await this.one<{ v: number | null }>(sql`SELECT max(version) AS v FROM schema_migrations`);
    return row?.v ?? 0;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connection.closeSync();
    this.instance.closeSync();
  }

  private async migrate(): Promise<void> {
    await this.connection.run(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMP DEFAULT current_timestamp)",
    );
    const current = await this.version();
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue;
      try {
        await this.connection.run("BEGIN TRANSACTION");
        for (const statement of m.statements) await this.connection.run(statement);
        await this.connection.run(`INSERT INTO schema_migrations (version) VALUES (${m.version})`);
        await this.connection.run("COMMIT");
      } catch (err) {
        await this.connection.run("ROLLBACK");
        throw new StoreError(
          "MIGRATION",
          `migration ${m.version} (${m.name}) failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }
  }

  private check(): void {
    if (this.closed) throw new StoreError("CLOSED", "workspace is closed");
  }
}

function normalizeRow(row: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = normalizeValue(v);
  return out;
}

function normalizeValue(v: unknown): unknown {
  if (typeof v === "bigint") return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(v) : v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalizeValue);
  return v;
}

/** Returns the embedded DuckDB engine version (e.g. `v1.5.6`) using a throwaway in-memory database. */
export async function duckdbVersion(): Promise<string> {
  const ws = await DuckDBInstance.create(":memory:");
  const c = await ws.connect();
  try {
    const value = (await c.runAndReadAll("SELECT version() AS v")).getRowObjects()[0]?.v;
    if (typeof value !== "string") throw new StoreError("DUCKDB_VERSION", "DuckDB returned no version string");
    return value;
  } finally {
    c.closeSync();
    ws.closeSync();
  }
}
