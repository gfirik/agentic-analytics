import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findFreeNumerals, placeholders, type Report, validateReport } from "../src/index.ts";

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
});
