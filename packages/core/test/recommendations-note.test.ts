// Backtest pre-tag 3: a report with findings and no recommendations says why (report-schema §1,
// `recommendations_note`), in the HTML and the plain-text summary. Scripted model only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { renderReportHtml, reportSummaryText } from "@agentic-analytics/report";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { afterAll, describe, expect, it } from "vitest";
import { runJob } from "../src/index.ts";
import { coffeePlanner } from "../testing/coffee-planner.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function run(decideFails?: "invalid" | "unsupported") {
  const dir = mkdtempSync(join(tmpdir(), "aa-recnote-"));
  dirs.push(dir);
  const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
  const model = coffeePlanner(decideFails ? { decideFails } : {});
  return (await runJob({ dir, files, options: { today: "2026-07-01", currency: "USD" } }, { model, embedder: hashEmbedder() })).report;
}

describe("an empty recommendations section says why", () => {
  it("the drafting step fails: the note, the summary line and the dropped record", async () => {
    const report = await run("invalid");
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.recommendations).toEqual([]);
    expect(report.recommendations_note).toBe("step_failed");
    expect(report.verification.claims_dropped.some((d) => d.claim === "(candidate actions)")).toBe(true);
    expect(reportSummaryText(report)).toContain(
      "Recommendations:\nNo recommendation could be produced: the step that drafts actions did not return a valid result. The findings above still stand.",
    );
    expect(reportSummaryText(report)).not.toMatch(/failed validation|attempts/);
    expect(renderReportHtml(report)).toContain("the step that drafts actions did not return a valid result");
  }, 180_000);

  it("candidates come back but none passes: says they were drafted and none passed", async () => {
    const report = await run("unsupported");
    expect(report.recommendations).toEqual([]);
    expect(report.recommendations_note).toBe("none_passed");
    expect(reportSummaryText(report)).toContain("Recommendations were drafted but none passed the checks.");
    expect(renderReportHtml(report)).toContain("Recommendations were drafted but none passed the checks.");
  }, 180_000);

  it("a normal job has recommendations and no note", async () => {
    const report = await run();
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations_note).toBeUndefined();
    expect(reportSummaryText(report)).not.toMatch(/No recommendation could be produced|none passed/);
  }, 180_000);
});
