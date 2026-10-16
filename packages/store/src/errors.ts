export class StoreError extends Error {
  constructor(
    readonly code: "DUCKDB_VERSION" | "BAD_IDENTIFIER" | "QUERY" | "MIGRATION" | "CLOSED",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "StoreError";
  }
}
