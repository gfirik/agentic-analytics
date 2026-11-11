// V4 for money (pre-tag 2): a fact states the currency and scale of the metric it measures.
import type { Fact, MetricDef } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import { moneyUnitProblem } from "../src/verify.ts";

const def = (o: Partial<MetricDef> = {}): MetricDef =>
  ({
    id: "revenue",
    label: "Revenue",
    type: "sum",
    table: "t",
    expression: "a",
    unit: "currency",
    currency: "UZS",
    status: "assumed",
    ...o,
  }) as MetricDef;
const fact = (o: Partial<Fact> = {}): Fact => ({
  id: "N1",
  label: "revenue_2026-01",
  value: 1,
  unit: "currency",
  currency: "UZS",
  computation: { kind: "sql", sql: "select 1" },
  citations: [],
  verified: false,
  ...o,
});

describe("moneyUnitProblem", () => {
  it("agrees when currency and scale match, with or without a scale", () => {
    expect(moneyUnitProblem(fact(), def())).toBeUndefined();
    expect(moneyUnitProblem(fact({ scale: "million" }), def({ scale: "million" }))).toBeUndefined();
  });
  it("flags a scale the fact lacks, one it adds, and one it changes", () => {
    expect(moneyUnitProblem(fact(), def({ scale: "million" }))).toMatch(/plain units, revenue is defined in million units/);
    expect(moneyUnitProblem(fact({ scale: "thousand" }), def())).toMatch(/thousand units/);
    expect(moneyUnitProblem(fact({ scale: "thousand" }), def({ scale: "million" }))).toMatch(
      /thousand units, revenue is defined in million/,
    );
  });
  it("flags another currency; non-money facts are not checked", () => {
    expect(moneyUnitProblem(fact({ currency: "USD" }), def())).toMatch(/is in USD, revenue is defined in UZS/);
    expect(moneyUnitProblem(fact({ unit: "percent", scale: "million" }), def())).toBeUndefined();
  });
});
