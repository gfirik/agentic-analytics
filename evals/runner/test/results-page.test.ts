// A run with unfinished jobs (a free tier's daily quota) is partial: its rates count those jobs as misses or cover
// only the finished few, so RESULTS.md judges no bar but "Jobs completed" (M13a review).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASELINE_REPORT_DIR, baselineReport, resultsMarkdown, resultsPage, type SuiteResult } from "../src/index.ts";

const score = (dataset: string, completed: boolean) =>
  ({
    dataset,
    completed,
    planted: [],
    distractorsReported: [],
    qualityFound: [],
    quality: 0,
    findings: 0,
    seconds: 1,
  }) as unknown as SuiteResult["scores"][number];
const run = (completed: boolean[]): SuiteResult => ({
  suite: "full",
  model: "m",
  date: "2026-10-17",
  datasets: completed.length,
  scores: completed.map((c, i) => score(`d${i}`, c)),
  bars: [
    { metric: "Jobs completed", value: completed.filter(Boolean).length / completed.length, bar: "100%", pass: completed.every(Boolean) },
    { metric: "Distractor FP rate", value: 0, bar: "≤ 10%", pass: true },
  ],
  seconds: 1,
  tokens: { input: 0, output: 0 },
});

describe("resultsMarkdown", () => {
  it("shows n/a (partial run) for every bar but Jobs completed when a job didn't finish", () => {
    const md = resultsMarkdown(run([true, false, false]));
    expect(md).toContain("| Jobs completed | 33.3% | 100% | **no** |");
    expect(md).toContain("| Distractor FP rate | 0.0% | ≤ 10% | n/a (partial run) |");
  });
  it("judges every bar when all jobs finished", () => {
    expect(resultsMarkdown(run([true, true]))).toContain("| Distractor FP rate | 0.0% | ≤ 10% | yes |");
  });
});

describe("the baseline report section (M14 PR 8)", () => {
  it("embeds the committed pages in name order, two heading levels down, after the real-data tier", () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-baseline-report-"));
    try {
      expect(baselineReport(dir)).toEqual([]);
      const folder = join(dir, BASELINE_REPORT_DIR);
      mkdirSync(folder);
      writeFileSync(join(folder, "2-b.md"), "# Second\n\n## Per task\n\nrow #1 stays\n");
      writeFileSync(join(folder, "1-a.md"), "# First\n\ntext\n");
      writeFileSync(join(folder, "1-a.json"), "{}");
      expect(baselineReport(dir)).toEqual([
        "## Baseline report (M14)",
        "",
        "### First\n\ntext",
        "",
        "### Second\n\n#### Per task\n\nrow #1 stays",
        "",
      ]);
      const page = resultsPage(dir);
      expect(page.indexOf("## Baseline report (M14)")).toBeGreaterThan(page.indexOf("## Real public data"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
