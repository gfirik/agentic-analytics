// Typed errors of the role detector (docs/specs/semantics.md §5: the door refuses what isn't in the vocabulary).
export type RoleErrorCode = "UNKNOWN_ROLE" | "UNKNOWN_COLUMN";

export class RoleError extends Error {
  readonly code: RoleErrorCode;
  constructor(code: RoleErrorCode, message: string) {
    super(message);
    this.name = "RoleError";
    this.code = code;
  }
}
