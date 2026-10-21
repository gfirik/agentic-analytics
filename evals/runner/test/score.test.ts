// Scoring (docs/EVALS.md §2) on hand-built reports: what counts as finding a planted event, a correct driver, a
// supported cause, a reported distractor, and the suite arithmetic.
import type { AnswerKey } from "@agentic-analytics/eval-generator";
import type { Fact, Finding, Report } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import {
  canonicalMetrics,
  citesLocation,
  keyPeriod,
  matchesDistractor,
  matchesPlanted,
  plantedDirection,
  rescore,
  type SuiteResult,
  scoreReport,
  subjectOf,
  summarize,
} from "../src/index.ts";

const fact = (id: string, label: string): Fact => ({
  id,
  label,
  value: 1,
  unit: "currency",
  computation: { kind: "sql", sql: "SELECT 1" },
  citations: [],
  verified: true,
});
const finding = (id: string, facts: string[], extra: Partial<Finding> = {}): Finding => ({
  id,
  type: "regression",
  severity: "high",
  title: id,
  claims: [{ text: "x", facts, citations: [], causal_grade: "observed", verified: true }],
  method: "m",
  confidence: "high",
  confidence_reasons: [],
  assumptions: [],
  ...extra,
});

const key: AnswerKey = {
  dataset: "t-v1",
  archetype: "t",
  business: "T",
  generator_version: 1,
  seed: 1,
  variant: 1,
  period: { from: "2026-01", to: "2026-06", grain: "month" },
  currency: "USD",
  today: "2026-07-01",
  files: ["sales.xlsx", "email-key.eml"],
  planted: [
    {
      id: "P1",
      type: "regression",
      metric: "revenue",
      period: "2026-04",
      driver: { dimension: "customer", member: "Key Co" },
      driver_alternatives: [{ dimension: "channel", member: "wholesale" }],
      persists: true,
      cause: { doc: "email-key.eml", grade_at_least: "document_supported" },
      good_actions: ["recover_share"],
      description: "",
    },
    { id: "P2", type: "regression", metric: "refund_rate", period: "2026-05", good_actions: [], description: "" },
  ],
  distractors: [
    {
      id: "D1",
      description: "",
      metric: "revenue",
      period: "2026-02",
      member: { dimension: "customer", member: "Web" },
      must_not_appear_as_finding: true,
    },
  ],
  quality: [{ id: "Q1", kind: "unit_error", file: "sales.xlsx", location: "sales.xlsx#Costs!D3", description: "" }],
};

function report(): Report {
  const facts = [
    fact("N1", "revenue_2026-03"),
    fact("N2", "revenue_2026-04"),
    fact("N3", "I5 trend_break.v1 revenue 2026-04:change"),
    fact("N4", "revenue[customer=Web]_2026-02"),
    fact("N5", "I7 anomaly.v1 revenue|customer=Web 2026-02:change"),
  ];
  return {
    facts,
    findings: [
      finding("F1", ["N1", "N2", "N3"], {
        drivers: [{ label: "“Key Co”", fact: "N3", share_of_change: "N3" }],
        claims: [
          { text: "x", facts: ["N1", "N2", "N3"], citations: [], causal_grade: "observed", verified: true },
          { text: "y", facts: [], citations: [{ source_id: "D1", quote: "q" }], causal_grade: "document_supported", verified: true },
        ],
      }),
      finding("F2", ["N4", "N5"]),
    ],
    recommendations: [
      {
        id: "R1",
        action: "a",
        because: ["F1"],
        rationale: [],
        impact: { metric_id: "revenue", low: "N1", high: "N2", horizon: "q", method: "impact.v1:recover_share", inputs: [] },
        confidence: "high",
        effort: "low",
        risk: "r",
        check: { metric_id: "revenue", comparator: ">=", threshold: "N1", by: "2026-09-30" },
      },
    ],
    sources: [
      { id: "D1", kind: "email", file: "email-key.eml" },
      { id: "T1", kind: "table", file: "sales.xlsx" },
    ],
    data_quality: [{ id: "Q1", kind: "unit_error", severity: "high", description: "d", citations: [{ source_id: "T1" }] }],
    verification: {
      numbers_checked: 5,
      numbers_mismatched: 0,
      rederived_metrics: 1,
      rederivation_mismatches: 0,
      definition_violations: 0,
      citations_checked: 4,
      citations_unsupported: 1,
      claims_dropped: [],
      claims_downgraded: [],
    },
  } as unknown as Report;
}

describe("scoring", () => {
  it("reads a finding's subject from its first claim: metric, member, before and after periods", () => {
    const r = report();
    expect(subjectOf(r.findings[0] as Finding, r)).toEqual({ metric: "revenue", before: "2026-03", period: "2026-04" });
    expect(subjectOf(r.findings[1] as Finding, r)).toEqual({
      metric: "revenue",
      member: { dimension: "customer", member: "Web" },
      period: "2026-02",
    });
  });

  it("credits a planted event only to a comparison that spans it (before < event ≤ after)", () => {
    const p = { type: "regression" as const, metric: "refund_rate", period: "2026-05" };
    expect(matchesPlanted({ metric: "refund_rate", before: "2026-04", period: "2026-05" }, p)).toBe(true);
    expect(matchesPlanted({ metric: "refund_rate", before: "2025-06", period: "2026-06" }, p)).toBe(true); // year on year
    // Entirely before the switch (pre-event noise), or entirely after it: not the event.
    expect(matchesPlanted({ metric: "refund_rate", before: "2026-03", period: "2026-04" }, p)).toBe(false);
    expect(matchesPlanted({ metric: "refund_rate", before: "2026-05", period: "2026-06" }, p)).toBe(false);
  });

  it("accepts the slice of the event's channel only, and the member must match", () => {
    const p = {
      type: "regression" as const,
      metric: "revenue",
      period: "2026-04",
      driver_alternatives: [{ dimension: "channel", member: "self-serve" }],
    };
    expect(matchesPlanted({ metric: "self_serve_revenue", before: "2026-03", period: "2026-04" }, p)).toBe(true);
    expect(matchesPlanted({ metric: "retail_revenue", before: "2026-03", period: "2026-04" }, p)).toBe(false);
    const m = { metric: "revenue", member: { dimension: "customer", member: "X" }, before: "2026-03", period: "2026-04" };
    expect(matchesPlanted(m, p)).toBe(false);
  });

  it("a finding moving the other way is not the planted event (a regression lowers revenue, raises a refund rate)", () => {
    const drop = { type: "regression" as const, metric: "revenue", period: "2026-04" };
    expect(matchesPlanted({ metric: "revenue", before: "2026-03", period: "2026-04", direction: "down" }, drop)).toBe(true);
    expect(matchesPlanted({ metric: "revenue", before: "2026-03", period: "2026-04", direction: "up" }, drop)).toBe(false);
    const refunds = { type: "regression" as const, metric: "refund_rate", period: "2026-05" };
    expect(plantedDirection(refunds)).toBe("up");
    expect(matchesPlanted({ metric: "refund_rate", before: "2026-04", period: "2026-05", direction: "down" }, refunds)).toBe(false);
  });

  it("a one-member distractor reported on the whole metric at its period is the same false alarm", () => {
    const d = { metric: "revenue", member: { dimension: "customer", member: "Cafe Nord" }, period: "2025-12" };
    expect(matchesDistractor({ metric: "revenue", before: "2025-11", period: "2025-12" }, d)).toBe(true);
    expect(matchesDistractor({ metric: "revenue", member: { dimension: "customer", member: "Other" }, period: "2025-12" }, d)).toBe(false);
  });

  it("a quality issue counts only on its key's sheet (and column, when both name a cell)", () => {
    const r = {
      sources: [
        { id: "T1", file: "sales.xlsx", locator: { sheet: "Costs", range: "A1:E13", table_id: "t1" } },
        { id: "T2", file: "sales.xlsx", locator: { sheet: "Orders", range: "A1:F300", table_id: "t2" } },
      ],
    } as unknown as Report;
    const q = { file: "sales.xlsx", location: "sales.xlsx#Costs!D9" };
    expect(citesLocation({ source_id: "T1", cells: ["D9"] }, q, r)).toBe(true);
    expect(citesLocation({ source_id: "T1", rows: [9] }, q, r)).toBe(true);
    expect(citesLocation({ source_id: "T2", cells: ["D9"] }, q, r)).toBe(false); // the right kind on the wrong sheet
    expect(citesLocation({ source_id: "T1", cells: ["B4"] }, q, r)).toBe(false);
  });

  it("reads week and quarter periods whole, and a day as its month", () => {
    expect(keyPeriod("2026-W12")).toBe("2026-W12");
    expect(keyPeriod("2026-Q1")).toBe("2026-Q1");
    expect(keyPeriod("2026-04-12")).toBe("2026-04");
  });

  it("reports a distractor at its period on its metric, on a metric it also moves, or a slice", () => {
    const d = { metric: "revenue", also: ["orders"], period: "2025-12" };
    expect(matchesDistractor({ metric: "orders", before: "2025-11", period: "2025-12" }, d)).toBe(true);
    expect(matchesDistractor({ metric: "retail_revenue", before: "2025-11", period: "2025-12" }, d)).toBe(true);
    expect(matchesDistractor({ metric: "revenue", before: "2025-06", period: "2026-06" }, d)).toBe(false);
  });

  it("scores detection, driver, cause, action relevance, distractors and quality", () => {
    const s = scoreReport(report(), key, { seconds: 2, tokens: { input: 10, output: 5 } });
    expect(s.planted).toEqual([
      { id: "P1", detected: true, rank: 1, driver: true, cause: true },
      { id: "P2", detected: false },
    ]);
    expect(s.distractorsReported).toEqual(["D1"]);
    expect(s.qualityFound).toEqual(["Q1"]);
    expect(s.groundedRecommendations).toBe(1);
    expect(s.actionRelevant).toBe(true);
  });

  it("a top recommendation about something else is a relevance miss; a wrong driver is a recall miss", () => {
    const r = report();
    const other = {
      ...r,
      recommendations: [{ ...(r.recommendations[0] as Report["recommendations"][number]), because: ["F2"] }],
    } as Report;
    expect(scoreReport(other, key, { seconds: 1, tokens: { input: 0, output: 0 } }).actionRelevant).toBe(false);
    const wrongDriver = {
      ...r,
      findings: r.findings.map((f, i) => (i === 0 ? { ...f, drivers: [{ label: "“Somebody”", fact: "N3", share_of_change: "N3" }] } : f)),
    } as Report;
    const s = scoreReport(wrongDriver, key, { seconds: 1, tokens: { input: 0, output: 0 } });
    expect(s.planted[0]).toMatchObject({ detected: true, driver: false });
    expect(summarize([s]).find((b) => b.metric === "Planted recall@5")?.value).toBe(0); // 0 of 2: P1's driver is wrong
  });

  it("a run with no quote checked fails citation precision instead of passing by accident", () => {
    const ok = scoreReport(report(), key, { seconds: 2, tokens: { input: 10, output: 5 } });
    const bars = summarize([{ ...ok, citationsChecked: 0, citationsUnsupported: 0 }]);
    expect(bars.find((b) => b.metric === "Citation precision")).toMatchObject({ value: undefined, pass: false });
    // An optional bar with nothing to measure stays n/a.
    const noCause = summarize([{ ...ok, planted: [] }]);
    expect(noCause.find((b) => b.metric === "Cause grade accuracy")?.pass).toBeUndefined();
    // A job aborted on a fact citing the wrong rows counts as a number mismatch.
    const cited = scoreReport(undefined, key, {
      seconds: 1,
      tokens: { input: 0, output: 0 },
      error: { code: "CITATION_MISMATCH", message: "m" },
    });
    expect(cited.numberMismatch).toBe(true);
  });

  it("summarizes with the EVALS bars (hand-computed)", () => {
    const ok = scoreReport(report(), key, { seconds: 2, tokens: { input: 10, output: 5 } });
    const failed = scoreReport(undefined, key, {
      seconds: 1,
      tokens: { input: 0, output: 0 },
      error: { code: "RECOMPUTE_MISMATCH", message: "m" },
    });
    const bars = Object.fromEntries(summarize([ok, failed]).map((b) => [b.metric, b]));
    expect(bars["Jobs completed"]?.value).toBe(0.5); // 1 of 2
    expect(bars["Number mismatches"]?.value).toBe(1);
    expect(bars["Planted recall@5"]?.value).toBe(0.25); // 1 of 4 planted (2 per dataset)
    expect(bars["Driver accuracy"]?.value).toBe(1);
    expect(bars["Distractor FP rate"]?.value).toBe(0.5); // 1 of 2
    expect(bars["Quality-issue recall"]?.value).toBe(0.5); // 1 of 2
    expect(bars["Citation precision"]?.value).toBe(0.75); // (4 − 1) / 4
    expect(bars["Distractor FP rate"]?.pass).toBe(false);
  });

  it("maps report metrics to the answer key's concepts by definition, whatever the model named them", () => {
    const sum = (id: string, filters: string[], expression = "coalesce(amount,0)") =>
      ({ id, label: id, type: "sum", table: "t_t1", expression, filters, unit: "currency", currency: "USD" }) as const;
    const r = {
      metrics: [
        sum("total_revenue", ["status = 'paid'"]),
        sum("monthly_revenue", [], "coalesce(revenue,0)"),
        sum("refunded_amount", ["status = 'refunded'"]),
        sum("wholesale_rev", ["status != 'refunded'", "channel = 'wholesale'"]),
        { id: "paid_orders", label: "x", type: "count", table: "t_t1", expression: "order_id", filters: [], unit: "count" },
        {
          id: "refund_rate_amount",
          label: "x",
          type: "ratio",
          numerator: { metric: "refunded_amount" },
          denominator: { metric: "total_revenue" },
          unit: "percent",
        },
        { id: "units", label: "x", type: "sum", table: "t_t1", expression: "qty", filters: [], unit: "count" },
        // A Costs sheet: never revenue, with or without a filter.
        sum("supplies", [], "coalesce(supplies,0)"),
        { ...sum("staff_costs", ["category = 'kitchen'"], "coalesce(amount,0)"), table: "t_t2", label: "Staff costs" },
        // Whole words: "rental" and "current" are not "rent".
        { ...sum("rental_income", [], "coalesce(rental_income,0)"), table: "t_t3", label: "Rental income" },
        { ...sum("current_revenue", [], "coalesce(current_amount,0)"), table: "t_t3", label: "Revenue (current)" },
      ],
    } as unknown as Report;
    expect(Object.fromEntries(canonicalMetrics(r))).toEqual({
      total_revenue: "revenue",
      monthly_revenue: "revenue",
      refunded_amount: "refunded_amount",
      wholesale_rev: "wholesale_revenue",
      paid_orders: "orders",
      refund_rate_amount: "refund_rate",
      units: "units",
      supplies: "supplies",
      staff_costs: "staff_costs",
      rental_income: "revenue",
      current_revenue: "revenue",
    });
  });

  it("rescore re-scores completed datasets from kept reports and keeps timings", () => {
    const routes = [{ role: "planner", route: "fake:m", calls: 3, cached: 0, failed: 0, inputTokens: 30, outputTokens: 9 }];
    const old = { ...scoreReport(report(), { ...key, planted: [] }, { seconds: 9, tokens: { input: 1, output: 2 } }), routes };
    const result: SuiteResult = {
      suite: "smoke",
      model: "m",
      date: "2026-10-16",
      datasets: 1,
      scores: [old],
      bars: summarize([old]),
      seconds: 9,
      tokens: { input: 1, output: 2 },
    };
    const r = rescore(result, new Map([["t-v1", report()]]), [{ id: "t-v1", answers: key, files: {} }]);
    expect(r.scores[0]?.planted.map((p) => p.id)).toEqual(["P1", "P2"]);
    expect(r.scores[0]?.seconds).toBe(9);
    expect(r.scores[0]?.routes).toEqual(routes); // the run's routes and tokens survive a rescore
    expect(r.bars.find((b) => b.metric === "Planted recall@5")?.value).toBe(0.5);
  });
});
