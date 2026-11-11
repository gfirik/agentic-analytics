// Backtest pre-tag 5: which findings get the nominal-amounts and the December caveat (hand-built findings and facts).
import type { Claim, Fact, Finding } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import { caveatAssumptions, DECEMBER_TEXT, isDecemberStep, NOMINAL_TEXT } from "../src/caveats.ts";

const fact = (id: string, label: string, unit: Fact["unit"], metric = "revenue"): Fact => ({
  id,
  label,
  value: 1,
  unit,
  metric_id: metric,
  computation: { kind: "sql", sql: "SELECT 1", params: {} },
  citations: [],
  verified: false,
});

/** A finding whose one observed claim goes from the first fact to the second. */
const finding = (id: string, ids: [string, string]): Finding => ({
  id,
  type: "anomaly",
  severity: "high",
  title: "t",
  method: "anomaly.v1",
  claims: [{ text: "x", facts: ids, citations: [], causal_grade: "observed", verified: false } as Claim],
  confidence: "medium",
  confidence_reasons: [],
  assumptions: [],
});

const facts = new Map(
  [
    fact("N1", "revenue_2023-11", "currency"),
    fact("N2", "revenue_2023-12", "currency"),
    fact("N3", "revenue_2022-12", "currency"),
    fact("N4", "revenue_2023-10", "currency"),
    fact("N5", "orders_2023-11", "count", "orders"),
    fact("N6", "orders_2023-12", "count", "orders"),
    fact("N7", "revenue_2023-12", "currency", "other"),
  ].map((f) => [f.id, f]),
);

describe("isDecemberStep", () => {
  it("is true only for consecutive months ending in December", () => {
    expect(isDecemberStep("2023-11", "2023-12")).toBe(true);
    expect(isDecemberStep("2022-12", "2023-12")).toBe(false); // year on year
    expect(isDecemberStep("2022-12", "2023-01")).toBe(false); // starts in December
    expect(isDecemberStep("2023-10", "2023-12")).toBe(false); // not consecutive
    expect(isDecemberStep("2023-Q3", "2023-Q4")).toBe(false); // not month grain
  });
});

/** The findings' own claims as the code-built ones (these hand-built findings have no model claims). */
const code = (fs: Finding[]) => new Map(fs.map((f) => [f.id, f.claims]));
const run = (fs: Finding[], first: number) => caveatAssumptions(fs, code(fs), facts, first);

describe("caveatAssumptions", () => {
  it("Nov to Dec on a money metric: both caveats, each affecting the finding, numbered from firstId", () => {
    const out = run([finding("F1", ["N1", "N2"])], 3);
    expect(out).toEqual([
      { id: "A3", text: NOMINAL_TEXT, affects: ["F1"], caveat: "nominal" },
      { id: "A4", text: DECEMBER_TEXT, affects: ["F1"], caveat: "seasonal" },
    ]);
  });
  it("the nominal assumption appears once however many findings compare money", () => {
    const out = run([finding("F1", ["N4", "N1"]), finding("F2", ["N3", "N2"])], 1);
    expect(out).toEqual([{ id: "A1", text: NOMINAL_TEXT, affects: ["F1", "F2"], caveat: "nominal" }]);
  });
  it("not a December step: no December caveat (year on year, October to November)", () => {
    expect(run([finding("F1", ["N3", "N2"])], 1).map((a) => a.text)).not.toContain(DECEMBER_TEXT);
    expect(run([finding("F1", ["N4", "N1"])], 1).map((a) => a.text)).not.toContain(DECEMBER_TEXT);
  });
  it("a count metric: no nominal assumption, the December caveat still applies", () => {
    expect(run([finding("F1", ["N5", "N6"])], 1)).toEqual([{ id: "A1", text: DECEMBER_TEXT, affects: ["F1"], caveat: "seasonal" }]);
  });
  it("a claim across two metrics is no December comparison, but still states a money change", () => {
    expect(run([finding("F1", ["N1", "N7"])], 1)).toEqual([{ id: "A1", text: NOMINAL_TEXT, affects: ["F1"], caveat: "nominal" }]);
  });
  it("a model claim alone never triggers a caveat: only code-built claims count", () => {
    // The finding is year on year; the model's own claim cites Nov and Dec revenue (and a currency fact).
    const yoy = finding("F1", ["N3", "N2"]);
    const model = { ...finding("F1", ["N1", "N2"]).claims[0], text: "model claim" } as Claim;
    const withModel = { ...yoy, claims: [...yoy.claims, model] };
    const out = caveatAssumptions([withModel], new Map([["F1", yoy.claims]]), facts, 1);
    expect(out.map((a) => a.caveat)).toEqual(["nominal"]); // from the code claim; no seasonal one from the model claim
    // A finding with only model claims (code built none) gets neither.
    expect(caveatAssumptions([withModel], new Map(), facts, 1)).toEqual([]);
  });
  it("no findings: nothing", () => {
    expect(run([], 1)).toEqual([]);
  });
});
