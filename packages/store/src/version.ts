import { DuckDBInstance } from "@duckdb/node-api";

/** Returns the embedded DuckDB engine version (e.g. `v1.5.6`) using a throwaway in-memory database. */
export async function duckdbVersion(): Promise<string> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll("SELECT version() AS v");
    const value = reader.getRowObjects()[0]?.v;
    if (typeof value !== "string") throw new StoreError("DUCKDB_VERSION", "DuckDB returned no version string");
    return value;
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

export class StoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StoreError";
  }
}
