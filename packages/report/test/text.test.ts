import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Report } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import { fillPlaceholders, reportSummaryText } from "../src/index.ts";

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
