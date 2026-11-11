// Backtest pre-tag 5: an engine caveat follows what justifies it, and none is left orphaned by VERIFY.
import type { Assumption, Claim, Fact, Finding } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import { liveAssumptions, withoutLostCaveats } from "../src/verify.ts";

const a = (id: string, affects: string[], caveat?: Assumption["caveat"]): Assumption => ({
  id,
  text: id,
  affects,
  ...(caveat ? { caveat } : {}),
});
const fact = (id: string, label: string): Fact => ({
  id,
  label,
  value: 1,
  unit: "currency",
  metric_id: "revenue",
  computation: { kind: "sql", sql: "SELECT 1", params: {} },
  citations: [],
  verified: true,
});
const facts = new Map([fact("N1", "revenue_2023-11"), fact("N2", "revenue_2023-12"), fact("N3", "revenue_2022-12")].map((f) => [f.id, f]));
const claim = (ids: string[]): Claim => ({ text: "x", facts: ids, citations: [], causal_grade: "observed", verified: true });
const finding = (id: string, claims: Claim[], assumptions: string[]): Finding =>
  ({
    id,
    type: "anomaly",
    severity: "high",
    title: "t",
    method: "anomaly.v1",
    claims,
    confidence: "medium",
    confidence_reasons: [],
    assumptions,
  }) as Finding;

const novDec = claim(["N1", "N2"]);
const yoy = claim(["N3", "N2"]);

describe("liveAssumptions", () => {
  it("removes a caveat none of whose findings survived, whichever the kind", () => {
    const out = liveAssumptions([a("A1", ["F1"], "seasonal"), a("A2", ["F1", "F2"], "nominal")], [], facts, new Set(["F3"]));
    expect(out).toEqual([]);
  });
  it("keeps a caveat that still affects a live finding, trimming the dropped ones", () => {
    const fs = [finding("F2", [novDec], ["A1"])];
    expect(liveAssumptions([a("A1", ["F1", "F2"], "seasonal")], fs, facts, new Set(["F2"]))).toEqual([a("A1", ["F2"], "seasonal")]);
  });
  it("leaves other assumptions as they were, even with nothing left to affect", () => {
    expect(liveAssumptions([a("A1", ["F1"]), a("A2", [])], [], facts, new Set(["F9"]))).toEqual([a("A1", []), a("A2", [])]);
  });
  it("the seasonal caveat leaves a finding whose November-to-December claim was dropped, but the nominal one stays", () => {
    const fs = [finding("F1", [yoy], ["A1", "A2"]), finding("F2", [novDec], ["A1", "A2"])];
    const out = liveAssumptions([a("A1", ["F1", "F2"], "seasonal"), a("A2", ["F1", "F2"], "nominal")], fs, facts, new Set(["F1", "F2"]));
    expect(out).toEqual([a("A1", ["F2"], "seasonal"), a("A2", ["F1", "F2"], "nominal")]);
  });
});

describe("withoutLostCaveats", () => {
  it("drops a caveat id a finding no longer carries, or one that was removed, and keeps everything else", () => {
    const drafted = [a("A1", ["F1", "F2"], "seasonal"), a("A2", ["F1"], "seasonal"), a("A3", ["F1"])];
    const kept = [a("A1", ["F2"], "seasonal"), a("A3", ["F1"])];
    const out = withoutLostCaveats([finding("F1", [yoy], ["A1", "A2", "A3"]), finding("F2", [novDec], ["A1"])], drafted, kept);
    expect(out.map((f) => f.assumptions)).toEqual([["A3"], ["A1"]]);
  });
});
