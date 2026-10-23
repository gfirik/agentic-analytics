// The optional model tie-break (docs/specs/semantics.md §2.4). The detector never imports a model: a caller that has one
// passes this interface, built on the ModelClient, and tests pass a FakeModel-backed one. It is off by default.
import type { Role } from "./vocabulary.ts";

/** When the top two candidates' scores are within this margin and a tie-break is given, it may choose between them. */
export const TIE_MARGIN = 0.1;

export interface TieBreakQuestion {
  readonly table_id: string;
  readonly column: string;
  readonly label: string;
  readonly type: string;
  /** At most five of the column's most frequent values, as the profile holds them. */
  readonly samples: readonly string[];
  /** The candidates within the margin of the top one, best first. The answer must be one of these. */
  readonly candidates: readonly { readonly role: Role; readonly score: number }[];
}

export interface RoleTieBreak {
  /** One of the offered roles, or `"undecided"`. Anything else is discarded by the detector. */
  choose(q: TieBreakQuestion): Promise<Role | "undecided">;
}

/** A sample value as the model sees it: digits masked (account and phone numbers stay private), cut at 40 characters. */
export const maskSample = (v: string): string => v.replace(/\d/g, "9").slice(0, 40);
