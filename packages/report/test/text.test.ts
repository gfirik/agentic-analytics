import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fact, Report } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import { fillPlaceholders, formatCell, formatFact, reportSummaryText } from "../src/index.ts";

const report = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "schema", "test", "fixtures", "report.coffee-roaster.json"), "utf8"),
) as Report;

describe("plain-text report views", () => {
  it("fills placeholders with formatted fact values and leaves unknown ids as written", () => {
    const f = report.facts[0];
    expect(fillPlaceholders(`x {{${f?.id}}} y {{N999999}}`, report.facts)).not.toContain(`{{${f?.id}}}`);
    expect(fillPlaceholders("{{N999999}}", report.facts)).toBe("{{N999999}}");
  });

  it("summarises the headline, three findings and two recommendations with no placeholder left", () => {
    const t = reportSummaryText(report);
    expect(t.split("\n")[0]).toBe(fillPlaceholders(report.summary.headline, report.facts));
    expect(t).not.toMatch(/\{\{N\d+\}\}/);
    expect((t.match(/^• /gm) ?? []).length).toBe(Math.min(3, report.findings.length) + Math.min(2, report.recommendations.length));
  });
});

describe("percentage points", () => {
  const fact = (fn: string, value: number): Fact => ({
    id: "N1",
    label: "x",
    value,
    unit: "percent",
    computation: { kind: "function", fn, inputs: [] },
    citations: [],
    verified: true,
  });
  it("a difference of percentages reads as points; a percent change stays a percent", () => {
    expect(formatFact(fact("delta", 2.2))).toBe("2.2 pp");
    expect(formatFact(fact("benchmark_gap.v1", 1.4))).toBe("1.4 pp");
    expect(formatFact(fact("share_shift", -10))).toBe("−10.0 pp");
    expect(formatFact(fact("pct_change", -17.913832199546484))).toBe("−17.9%");
  });
});

describe("formatCell keeps the sign of a rate", () => {
  it("a negative rate cell shows its minus sign", () => {
    expect(formatCell(-0.123, "Refund rate")).toBe("−12.3%");
    expect(formatCell(0.123, "Refund rate")).toBe("12.3%");
    expect(formatCell(0.123, "refund_rate")).toBe("12.3%");
    // "rate" inside another word is not a rate column.
    expect(formatCell(0.5, "Corporate client")).toBe("0.50");
    expect(formatCell(0.5, "Separate fee")).toBe("0.50");
  });
});
