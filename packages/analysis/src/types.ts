// Shared shapes. Templates and decomposers are pure: they read series and return `Calc` records (a number,
// its unit, the function that produced it and its inputs). The runner turns points and calcs into facts with
// computation records and citations (report-schema §3), so every number stays traceable.

export type Unit = "currency" | "percent" | "count" | "ratio" | "days" | "other";

export interface Point {
  readonly period: string;
  readonly value: number;
}

/** A metric's values per period (sorted by period), optionally for one dimension member. */
export interface Series {
  readonly id: string; // series key, e.g. "revenue" or "revenue|channel=wholesale"
  readonly metric: string;
  readonly unit: Unit;
  readonly member?: { readonly dimension: string; readonly value: string | null };
  readonly points: readonly Point[];
}

/** A reference to an input number: a measured point of a series, or another calc by name. */
export type Ref =
  | { readonly kind: "point"; readonly series: string; readonly period: string }
  | { readonly kind: "calc"; readonly name: string }
  /** A fact that already exists in the job (e.g. an agent tool computing on top of the analysis). */
  | { readonly kind: "fact"; readonly id: string };

export interface Calc {
  readonly name: string; // unique within one insight/decomposition
  readonly label: string;
  readonly value: number;
  readonly unit: Unit;
  /** Method id, e.g. "pct_change", "contribution.v1", "theil_sen". */
  readonly fn: string;
  readonly inputs: readonly Ref[];
  /**
   * The fact's label when it is one of analysis-library §14's fixed labels (`pvm_margin.cost_2026-03`); otherwise the
   * fact is labelled `<context>:<name>`. A fixed label names one fact in a report.
   */
  readonly factLabel?: string;
}

export type Confidence = "high" | "medium" | "low";

/** The member that groups everything beyond the top N members of a dimension (spec §1). */
export const OTHER = "(other)";
/** A grouping artifact, never a member to name in a finding; it still counts in sums and shares. */
export const isOther = (m: Series): boolean => m.member?.value === OTHER;

export const point = (series: string, period: string): Ref => ({ kind: "point", series, period });
export const calcRef = (name: string): Ref => ({ kind: "calc", name });
export const factRef = (id: string): Ref => ({ kind: "fact", id });
