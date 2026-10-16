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
  | { readonly kind: "calc"; readonly name: string };

export interface Calc {
  readonly name: string; // unique within one insight/decomposition
  readonly label: string;
  readonly value: number;
  readonly unit: Unit;
  /** Method id, e.g. "pct_change", "contribution.v1", "theil_sen". */
  readonly fn: string;
  readonly inputs: readonly Ref[];
}

export type Confidence = "high" | "medium" | "low";

export const point = (series: string, period: string): Ref => ({ kind: "point", series, period });
export const calcRef = (name: string): Ref => ({ kind: "calc", name });
