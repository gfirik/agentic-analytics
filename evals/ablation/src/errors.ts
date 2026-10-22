// Typed errors of the ablation harness (docs/specs/accuracy.md §8). The SQL codes are what arm B's `run_sql` returns to
// the model as a tool error; each one counts against the arm's retry budget of 2.

export type AblationErrorCode =
  /** DuckDB refused the statement: a write, a file or network access, an extension, a settings change. */
  | "SQL_REFUSED"
  /** The statement ran past its time limit and was interrupted. */
  | "SQL_TIMEOUT"
  /** The statement needed more than the instance's memory limit. */
  | "SQL_OUT_OF_MEMORY"
  /** The statement needed to spill more than the per-run temp directory allows. */
  | "SQL_OUT_OF_SPACE"
  /** The result has more rows or bytes than go back into the model's prompt. */
  | "RESULT_TOO_LARGE"
  /** Any other statement error (syntax, an unknown table or column): the model's mistake. */
  | "SQL_ERROR"
  /** A tool error or an invalid answer after the 2 retries were spent. */
  | "RETRY_BUDGET"
  /** The answer was not the fixed JSON shape. */
  | "BAD_ANSWER"
  /** The model's context window can't hold the prompt. */
  | "CONTEXT_TOO_SMALL"
  | "USAGE"
  | "NO_DATA";

export const SQL_ERROR_CODES: ReadonlySet<AblationErrorCode> = new Set([
  "SQL_REFUSED",
  "SQL_TIMEOUT",
  "SQL_OUT_OF_MEMORY",
  "SQL_OUT_OF_SPACE",
  "RESULT_TOO_LARGE",
  "SQL_ERROR",
]);

export class AblationError extends Error {
  constructor(
    readonly code: AblationErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AblationError";
  }
}
