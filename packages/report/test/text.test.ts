import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fact, Report } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import { fillPlaceholders, formatCell, formatFact, formatPeriod, reportSummaryText } from "../src/index.ts";

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

describe("files that were not read", () => {
  it("the summary lists each skipped file on its own line, with the fix", () => {
    const withFiles: Report = {
      ...report,
      data_quality: [
        {
          id: "Q1",
          kind: "archive_rejected",
          severity: "medium",
          description: 'The file "reviews.csv.gz" is gzip-compressed. Unzip it first.',
          citations: [],
        },
        {
          id: "Q2",
          kind: "too_large",
          severity: "medium",
          description: 'The file "big.csv" is over the per-file size limit. Split the file.',
          citations: [],
        },
        { id: "Q3", kind: "missing_value", severity: "low", description: "Some values are empty.", citations: [] },
      ],
    };
    const t = reportSummaryText(withFiles);
    expect(t).toContain('Files not read:\n• The file "reviews.csv.gz" is gzip-compressed. Unzip it first.\n• The file "big.csv"');
    expect(t).not.toContain("Some values are empty");
    expect(reportSummaryText({ ...report, data_quality: [] })).not.toContain("Files not read");
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
    expect(formatCell(0.123, "refundRate")).toBe("12.3%");
    // "rate" inside another word is not a rate column.
    expect(formatCell(0.5, "Corporate client")).toBe("0.50");
    expect(formatCell(0.5, "Separate fee")).toBe("0.50");
  });
});

describe("a report that read no numbers", () => {
  const none: Report = {
    ...report,
    sources: [],
    metrics: [],
    findings: [],
    recommendations: [],
    summary: { headline: "No numbers could be read from these files: no table was found.", bullets: [], no_numbers: "no_table" },
  };
  it("names what was read, or that nothing was", () => {
    expect(reportSummaryText(none)).toBe("No numbers could be read from these files: no table was found.\n\nRead: nothing\n");
    const src = report.sources[0];
    if (src) expect(reportSummaryText({ ...none, sources: [src] })).toContain(`Read: ${src.file} (${src.kind})`);
  });
  it("shows no period for the placeholder bounds 0000 and 9999", () => {
    expect(formatPeriod("0000", "9999")).toBe("no period");
    expect(formatPeriod("2026-01", "2026-06")).toBe("Jan–Jun 2026");
  });
});
