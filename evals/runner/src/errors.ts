// Typed errors of the eval runner (AGENTS.md §4).
export class EvalRunError extends Error {
  constructor(
    readonly code: "NO_MODEL" | "USAGE" | "NO_DATA" | "UNKNOWN_DATASET" | "BAD_RESULTS",
    message: string,
  ) {
    super(message);
    this.name = "EvalRunError";
  }
}
