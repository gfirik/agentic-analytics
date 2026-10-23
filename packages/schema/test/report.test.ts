import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findFreeNumerals, periodYears, placeholders, type Report, validateReport } from "../src/index.ts";

const fixturePath = join(import.meta.dirname, "fixtures", "report.coffee-roaster.json");
const fixture = (): Report => JSON.parse(readFileSync(fixturePath, "utf8")) as Report;

function issuesOf(mutate: (r: Report) => void): string[] {
  const r = fixture();
  mutate(r);
  const res = validateReport(r);
  return res.ok ? [] : res.issues.map((i) => `${i.path}: ${i.message}`);
}

describe("report v1 fixture", () => {
  it("validates (schema + integrity)", () => {
    const res = validateReport(fixture());
    expect(res.ok ? [] : res.issues).toEqual([]);
  });

  it("has the golden coffee-roaster numbers", () => {
    const facts = new Map(fixture().facts.map((f) => [f.label, f.value]));
    // 36,200 / 44,100 − 1 = −0.17914 → −17.9%
    expect(facts.get("revenue_change_pct_2026-04_vs_2026-03")?.toFixed(1)).toBe("-17.9");
    // wholesale −8,500 of a −7,900 total → 8,500 / 7,900 = 1.0759 → 108%
    expect(facts.get("wholesale_share_of_revenue_change_2026-04")?.toFixed(0)).toBe("108");
    expect(facts.get("refund_rate_2026-03")).toBe(1.2);
    expect(facts.get("refund_rate_2026-06")).toBe(3.4);
  });

  it("has hand-computed values for every derived fact", () => {
    const facts = new Map(fixture().facts.map((f) => [f.label, f.value]));
    const expected: Record<string, number> = {
      "revenue_change_2026-04_vs_2026-03": -7900, // 36,200 − 44,100
      "wholesale_revenue_change_2026-04_vs_2026-03": -8500, // 7,400 − 15,900
      "retail_revenue_change_2026-04_vs_2026-03": 600, // 28,800 − 28,200
      "wholesale_revenue_decline_2026-04_vs_2026-03": 8500, // |−8,500|
      "excess_refund_cost_per_month_2026-06": 814, // (3.4% − 1.2%) × 37,000 = 0.022 × 37,000
      "retail_revenue_change_pct_2026-06_vs_2026-01": 12.5, // 29,700 / 26,400 − 1 = 0.125
      r1_impact_low_per_month: 3995, // 8,500 × 0.5 × (1 − 0.06) = 4,250 × 0.94
      r1_impact_high_per_month: 7191, // 8,500 × 0.9 × 0.94 = 7,650 × 0.94
      "r1_check_wholesale_2026-07": 11395, // April wholesale 7,400 + low impact 3,995
      r2_impact_low_per_month: 407, // 814 × 0.5
      "packaging_cost_2026-02": 1240000, // the planted ×1000 typo
      "packaging_cost_median_excluding_2026-02": 1260, // median of 1,180 · 1,210 · 1,260 · 1,350 · 1,390
    };
    for (const [label, value] of Object.entries(expected)) expect(facts.get(label), label).toBeCloseTo(value, 9);
    // 1,240,000 / 1,260 = 984.127…
    expect(facts.get("packaging_cost_ratio_2026-02_to_median")?.toFixed(3)).toBe("984.127");
    // −8,500 / 15,900 = −0.534591… → 53.5%
    expect(facts.get("wholesale_revenue_decline_pct_2026-04_vs_2026-03")?.toFixed(1)).toBe("53.5");
  });
});

describe("report v1 rejects broken reports", () => {
  it("unknown fact in a placeholder", () => {
    expect(issuesOf((r) => (r.summary.headline = "Revenue fell {{N999}}."))).toContain("summary.headline: unknown fact N999");
  });

  it("free numerals in model text", () => {
    const issues = issuesOf((r) => {
      const c = r.findings[0]?.claims[0];
      if (c) c.text = "Revenue fell 17.9% in April.";
    });
    expect(issues.some((i) => i.includes("free numerals not backed by a fact: 17.9"))).toBe(true);
  });

  it("free numerals anywhere a reader sees text (descriptions, risks, questions)", () => {
    const issues = issuesOf((r) => {
      if (r.data_quality[0]) r.data_quality[0].description = "Packaging is about 1,000 times higher.";
      if (r.recommendations[0]) r.recommendations[0].risk = "Costs 500 a month.";
      if (r.open_questions[0]) r.open_questions[0].question = "Did 3 clients leave?";
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        "data_quality[0].description: free numerals not backed by a fact: 1,000",
        "recommendations[0].risk: free numerals not backed by a fact: 500",
        "open_questions[0].question: free numerals not backed by a fact: 3",
      ]),
    );
  });

  it("placeholder not listed in claim.facts", () => {
    const issues = issuesOf((r) => {
      const c = r.findings[0]?.claims[0];
      if (c) c.facts = [];
    });
    expect(issues.some((i) => i.includes("is not listed in claim.facts"))).toBe(true);
  });

  it("citation to an unknown source", () => {
    const issues = issuesOf((r) => r.findings[0]?.claims[0]?.citations.push({ source_id: "S99" }));
    expect(issues).toContain("findings[0].claims[0].citations[1].source_id: unknown source S99");
  });

  it("recommendation without a known finding", () => {
    expect(
      issuesOf((r) => {
        if (r.recommendations[0]) r.recommendations[0].because = ["F9"];
      }),
    ).toContain("recommendations[0].because[0]: unknown finding F9");
  });

  it("more than 5 summary bullets", () => {
    const issues = issuesOf((r) => {
      const b = r.summary.bullets[0];
      if (b) r.summary.bullets = [b, b, b, b, b, b];
    });
    expect(issues.some((i) => i.startsWith("summary.bullets"))).toBe(true);
  });

  it("web sources must be external and only web sources", () => {
    const issues = issuesOf((r) => {
      const s = r.sources.find((x) => x.kind === "web");
      if (s) s.external = false;
    });
    expect(issues.some((i) => i.includes("external is true only for web sources"))).toBe(true);
  });

  it("wrong schema id and bad enum", () => {
    expect(validateReport({ ...fixture(), schema: "agentic-analytics.report/v2" }).ok).toBe(false);
    expect(issuesOf((r) => ((r.findings[0] as { type: string }).type = "disaster")).length).toBeGreaterThan(0);
  });
});

describe("text helpers", () => {
  it("extracts placeholders", () => {
    expect(placeholders("from {{N1}} to {{N22}}")).toEqual(["N1", "N22"]);
  });

  it("allows dates and quoted source text, flags other numerals", () => {
    expect(findFreeNumerals("On 28 April 2026, after 2026-03-15, “prices rose 12%”, revenue was {{N2}}.")).toEqual([]);
    expect(findFreeNumerals("Revenue fell 7,900 in April")).toEqual(["7,900"]);
  });

  it("a bare year is a date only if it is one of the job's period years; dates need a month or a period form (M14a)", () => {
    const years = periodYears(["revenue_2025-04", "revenue_2026-04", "2026"]);
    expect([...years].sort()).toEqual(["2025", "2026"]);
    // Model-made counts that used to pass as "dates" (code-quality review §2 row 3), including after date-like words.
    for (const text of [
      "We lost 2000 customers",
      "Revenue was 1999 in April",
      "The top 3 may churn",
      "Sales fell ٣٠٪",
      "in 2000 stores",
      "of 2001 orders",
      "year 1999 units",
      "Revenue fell by 2000",
      "Orders rose to 2024",
      "FY 2000 stores",
      "1999-13 units",
    ])
      expect(findFreeNumerals(text, years).length, text).toBeGreaterThan(0);
    // Real dates pass, with or without the job's years.
    for (const text of [
      "since March 15, 2026",
      "on 3 May",
      "12th April",
      "MAY 2026",
      "dec 12",
      "Q1 2026",
      "2025-Q4",
      "2025-W51",
      "2026-04",
      "Выручка упала в 2026 году",
      "2026-yil",
    ])
      expect(findFreeNumerals(text), text).toEqual([]);
    // A bare year is a date when the job covers it, in any phrasing.
    for (const text of ["Revenue fell in 2026", "between 2025 and 2026", "2025 vs 2026", "Revenue 2025–2026", "for 2026"])
      expect(findFreeNumerals(text, years), text).toEqual([]);
    expect(findFreeNumerals("in 2026")).toEqual(["2026"]);
    // Deliberate: a short second year is a count-looking number, not a period ("2026/27").
    expect(findFreeNumerals("in 2026/27", years)).toEqual(["27"]);
  });

  it("periodYears reads only where a period sits in a label, never a member (bracketed or `|dim=value`) or an amount", () => {
    expect([...periodYears(["revenue_2025", "revenue_2026"])].sort()).toEqual(["2025", "2026"]); // yearly grain
    expect([...periodYears(["revenue[store=2000-01]_2026-04"])]).toEqual(["2026"]);
    expect([...periodYears(["orders[sku=2000Q1]_2026"])]).toEqual(["2026"]);
    expect([...periodYears(["contribution.v1 revenue 2026-04 by channel:delta:2000-01"])]).toEqual(["2026"]);
    expect([...periodYears(["I3 period_change revenue|store=Promo 2000-01 2026-04:delta"])]).toEqual(["2026"]); // a `|dim=value` member
    expect([...periodYears(["revenue_2025-Q4", "2026-W51"])].sort()).toEqual(["2025", "2026"]);
    expect([...periodYears(["orders 2000"])]).toEqual([]);
  });

  it("stays linear on long text (no backtracking)", () => {
    const t0 = performance.now();
    findFreeNumerals(`x${" ".repeat(100_000)}2026 April${" ".repeat(100_000)}12`);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("roles, table kinds and the business model (report-schema §5b, additive in M15)", () => {
  /** Adds the three optional fields, wired to the fixture's own source and fact ids. */
  function withSemantics(r: Report): Report {
    const source = r.sources[0]?.id ?? "";
    const fact = r.facts[0]?.id ?? "";
    r.assumptions.push({ id: "A9", text: "Business model assumed: wholesale (a few customers hold most of the revenue).", affects: [] });
    r.roles = [
      {
        table_id: source,
        column: "unit_cost",
        role: "unit_cost",
        status: "assumed",
        source: "detector",
        evidence: [
          { kind: "name", text: 'header ends with "cost"' },
          { kind: "identity", text: `margin identity holds on {{${fact}}} of rows`, fact },
        ],
      },
    ];
    r.table_kinds = [{ table_id: source, kind: "sales_lines", evidence: ["transaction_date", "amount", "customer"] }];
    r.business_model = {
      model: "wholesale",
      status: "assumed",
      assumption: "A9",
      signals: [{ text: `the ten largest customers hold {{${fact}}} of the revenue`, fact }],
    };
    return r;
  }

  it("a report with them validates, and one without them still does (every v1 report stays valid)", () => {
    const res = validateReport(withSemantics(fixture()));
    expect(res.ok ? [] : res.issues).toEqual([]);
    expect(validateReport(fixture()).ok).toBe(true);
  });

  it("round-trips through JSON unchanged", () => {
    const r = withSemantics(fixture());
    const res = validateReport(JSON.parse(JSON.stringify(r)));
    expect(res.ok && res.report.roles).toEqual(r.roles);
    expect(res.ok && res.report.business_model).toEqual(r.business_model);
  });

  it("refuses a role outside the vocabulary and the role none (a column with no role is left out)", () => {
    expect(issuesOf((r) => (((withSemantics(r).roles ?? [])[0] as { role: string }).role = "revenue")).join("\n")).toContain(
      "roles.0.role",
    );
    expect(issuesOf((r) => (((withSemantics(r).roles ?? [])[0] as { role: string }).role = "none")).join("\n")).toContain("roles.0.role");
  });

  it("refuses an unknown table kind and an unknown business model", () => {
    expect(issuesOf((r) => (((withSemantics(r).table_kinds ?? [])[0] as { kind: string }).kind = "ledger")).join("\n")).toContain(
      "table_kinds.0.kind",
    );
    expect(
      issuesOf((r) => (((withSemantics(r).business_model ?? { model: "" }) as { model: string }).model = "bank")).join("\n"),
    ).toContain("business_model.model");
  });

  it("integrity: facts, sources and the assumption must resolve", () => {
    expect(issuesOf((r) => (((withSemantics(r).roles ?? [])[0] as { table_id: string }).table_id = "T99")).join("\n")).toContain(
      "unknown source T99",
    );
    expect(issuesOf((r) => (((withSemantics(r).roles ?? [])[0]?.evidence[1] as { fact: string }).fact = "N9999")).join("\n")).toContain(
      "unknown fact N9999",
    );
    expect(
      issuesOf((r) => (((withSemantics(r).business_model ?? { assumption: "" }) as { assumption: string }).assumption = "A77")).join("\n"),
    ).toContain("unknown assumption A77");
    expect(issuesOf((r) => (((withSemantics(r).table_kinds ?? [])[0] as { table_id: string }).table_id = "T99")).join("\n")).toContain(
      "unknown source T99",
    );
  });

  it("integrity: evidence and signal texts carry no free numerals", () => {
    expect(
      issuesOf((r) => (((withSemantics(r).roles ?? [])[0]?.evidence[0] as { text: string }).text = "holds on 97% of rows")).join("\n"),
    ).toContain("free numerals");
    expect(
      issuesOf((r) => (((withSemantics(r).business_model?.signals ?? [])[0] as { text: string }).text = "ten customers hold 80%")).join(
        "\n",
      ),
    ).toContain("free numerals");
  });
});
