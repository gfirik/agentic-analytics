// Typed errors of the real-data tier (AGENTS.md §4).
export class RealDataError extends Error {
  constructor(
    readonly code: "DOWNLOAD_FAILED" | "CHECKSUM_MISMATCH" | "ENTRY_MISSING" | "UNEXPECTED_LAYOUT",
    message: string,
  ) {
    super(message);
    this.name = "RealDataError";
  }
}
