// The real-data tier (evals/real): scoring each kind of check against a hand-built report, the RESULTS.md section,
// an end-to-end job on a small invoice-line file (grouped quality items, the partial last month left out), and,
// when the public files have been fetched, a re-run that must reproduce the committed results.
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJob } from "@agentic-analytics/core";
import type { RealCheck } from "@agentic-analytics/eval-real";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import type { Report } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import {
  baselineModel,
  loadRealAnswers,
  missingRealData,
  type RealSuiteResult,
  realEvalCommand,
  realResultsMarkdown,
  resultsPage,
  runRealSuite,
  scoreCheck,
} from "../src/index.ts";

const fact = (id: string, label: string, value: number) => ({
  id,
  label,
  value,
  unit: "currency" as const,
  computation: { kind: "sql" as const, sql: "SELECT 1" },
  citations: [],
  verified: true,
});

/** Revenue Oct 2025 – Jan 2026 (60, 100, 80, 50); one finding on the December → January fall. */
const REPORT = {
  metrics: [],
  facts: [
    fact("N1", "revenue_2025-10", 60),
    fact("N2", "revenue_2025-11", 100),
    fact("N3", "revenue_2025-12", 80),
    fact("N4", "revenue_2026-01", 50),
    { ...fact("N5", "rows with negative quantity in quantity", 2), unit: "count" as const },
  ],
  findings: [
    {
      id: "F1",
      type: "regression",
      severity: "high",
      title: "A change in revenue",
      claims: [{ text: "Revenue went from {{N3}} to {{N4}}.", facts: ["N3", "N4"], citations: [], verified: true }],
      method: "period_change.v1",
      confidence: "high",
      confidence_reasons: [],
      assumptions: [],
    },
  ],
  data_quality: [
    {
      id: "Q1",
      kind: "negative_quantity",
      severity: "medium",
      description: "Some quantities are negative (column “quantity” in “lines.csv”; {{N5}} rows).",
      citations: [{ source_id: "T1", rows: [5, 11] }],
    },
  ],
  verification: {
    numbers_checked: 4,
    numbers_mismatched: 0,
    rederived_metrics: 0,
    rederivation_mismatches: 0,
    definition_violations: 0,
    citations_checked: 0,
    citations_unsupported: 0,
    claims_dropped: [],
    claims_downgraded: [],
  },
} as unknown as Report;

const pass = (c: RealCheck, r: Report | undefined = REPORT) => scoreCheck(c, r).pass;
const base = { id: "C", about: "x" };

describe("scoreCheck", () => {
  it("completes and verified", () => {
    expect(pass({ ...base, kind: "completes" })).toBe(true);
    expect(pass({ ...base, kind: "verified" })).toBe(true);
    // A shipped report can't hold a mismatch; what fails is a report with nothing recomputed, or a definition broken.
    const unchecked = { ...REPORT, verification: { ...REPORT.verification, numbers_checked: 0 } } as Report;
    expect(pass({ ...base, kind: "verified" }, unchecked)).toBe(false);
    const broken = { ...REPORT, verification: { ...REPORT.verification, definition_violations: 1 } } as Report;
    expect(pass({ ...base, kind: "verified" }, broken)).toBe(false);
    expect(scoreCheck({ ...base, kind: "completes" }, undefined, "INGEST: boom")).toMatchObject({
      pass: false,
      detail: "no report: INGEST: boom",
    });
  });

  it("quality_issue matches the kind and the column named in the description", () => {
    expect(pass({ ...base, kind: "quality_issue", issue: "negative_quantity", column: "quantity" })).toBe(true);
    expect(pass({ ...base, kind: "quality_issue", issue: "negative_quantity", column: "price" })).toBe(false);
    expect(pass({ ...base, kind: "quality_issue", issue: "missing_id", column: "quantity" })).toBe(false);
    // The count is the fact behind the placeholder (N5 = 2)
    expect(pass({ ...base, kind: "quality_issue", issue: "negative_quantity", column: "quantity", count: 2 })).toBe(true);
    expect(pass({ ...base, kind: "quality_issue", issue: "negative_quantity", column: "quantity", count: 3 })).toBe(false);
  });

  it("seasonal_peak reads the monthly facts: peak month and values against SQL", () => {
    const peak = { ...base, kind: "seasonal_peak" as const, metric: "revenue", years: [2025], tolerance: 0.01 };
    expect(pass({ ...peak, months: [11, 12], values: { "2025-11": 100, "2025-12": 80 } })).toBe(true);
    // November (100) is the 2025 peak, not December
    expect(pass({ ...peak, months: [12], values: {} })).toBe(false);
    // A value 0.02 away from the SQL result is outside the 0.01 tolerance
    expect(scoreCheck({ ...peak, months: [11], values: { "2025-11": 100.02 } }, REPORT)).toMatchObject({
      pass: false,
      detail: "2025 peak 2025-11; 0/1 values equal SQL (2025-11: report 100 vs SQL 100)",
    });
    expect(pass({ ...peak, years: [2024], months: [11], values: {} })).toBe(false);
    expect(pass({ ...peak, metric: "orders", months: [11], values: {} })).toBe(false);
  });

  it("finding_at needs the metric, the month and the direction (80 → 50 is down)", () => {
    const at = { ...base, kind: "finding_at" as const, metric: "revenue", period: "2026-01" };
    expect(pass({ ...at, direction: "down" })).toBe(true);
    expect(pass({ ...at, direction: "up" })).toBe(false);
    expect(pass({ ...at, period: "2025-12", direction: "down" })).toBe(false);
  });

  it("no_finding_at and seasonal_not_flagged", () => {
    expect(pass({ ...base, kind: "no_finding_at", period: "2026-01" })).toBe(false);
    expect(pass({ ...base, kind: "no_finding_at", period: "2025-12" })).toBe(true);
    // F1 compares January with the December just before it
    expect(pass({ ...base, kind: "seasonal_not_flagged", metric: "revenue", months: [1] })).toBe(false);
    expect(pass({ ...base, kind: "seasonal_not_flagged", metric: "revenue", months: [2] })).toBe(true);
    expect(pass({ ...base, kind: "seasonal_not_flagged", metric: "orders", months: [1] })).toBe(true);
  });
});

describe("RESULTS.md", () => {
  it("adds the real-data section with each dataset's checks", () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-real-results-"));
    try {
      const r: RealSuiteResult = {
        suite: "real",
        model: "baseline",
        date: "2026-10-16",
        seconds: 1,
        datasets: [
          {
            dataset: "toy",
            title: "Toy data",
            publisher: "Test",
            licence: "CC BY 4.0",
            citation: "Toy (2026).",
            page: "https://example.org",
            file: "toy.csv",
            sha256: "a".repeat(64),
            completed: true,
            seconds: 1,
            metrics: ["revenue"],
            findings: [],
            quality: ["missing_id"],
            checks: [{ id: "C1", kind: "completes", about: "It completes", pass: true, detail: "report with 0 findings" }],
          },
        ],
      };
      writeFileSync(join(dir, "2026-10-16-baseline-real.json"), JSON.stringify(r));
      const page = resultsPage(dir);
      expect(page).toContain("## Real public data");
      expect(page).toContain("#### Toy data (Test, CC BY 4.0)");
      expect(page).toContain("| C1: It completes | yes | report with 0 findings |");
      expect(resultsPage(join(dir, "none"))).toContain("No real-data runs yet.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Ten invoice lines plus two in March that stop on the 9th: rows 5 (C1003, −1) and 11 (−2) are negative.
const LINES = `Invoice,StockCode,Quantity,InvoiceDate,Price,Customer ID,Country
1001,A,2,2026-01-05 10:00:00,1.50,11,UK
1001,B,1,2026-01-05 10:00:00,4.00,11,UK
1002,A,4,2026-01-12 11:00:00,1.50,12,France
C1003,A,-1,2026-01-20 09:00:00,1.50,11,UK
1004,B,3,2026-01-28 12:00:00,4.00,,UK
1005,A,10,2026-02-03 12:00:00,1.25,12,UK
1005,B,2,2026-02-03 12:00:00,4.00,12,UK
1006,A,1,2026-02-14 08:00:00,1.50,,France
1007,B,5,2026-02-21 15:00:00,4.00,13,UK
1008,A,-2,2026-02-27 16:00:00,1.50,13,UK
1009,A,3,2026-03-02 10:00:00,1.50,14,UK
1010,B,1,2026-03-09 11:00:00,4.00,14,UK
`;

describe("a job on invoice lines", () => {
  it("groups quality items per column and leaves the partial last month out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-lines-"));
    try {
      const { report } = await runJob(
        {
          dir,
          jobId: "lines",
          files: [{ name: "lines.csv", bytes: new TextEncoder().encode(LINES) }],
          options: { today: "2026-10-16", currency: "GBP" },
        },
        { model: baselineModel(), embedder: hashEmbedder() },
      );
      // The data stops on 9 March (9/31 of the month): March is left out.
      expect(report.period).toEqual({ from: "2026-01", to: "2026-02", grain: "month" });
      expect(report.assumptions.map((a) => a.text)).toContain(
        "The data stops early in its last month, so that part-month is left out: comparing it with whole months would read as a fall.",
      );
      expect(report.data_quality.map((q) => [q.id, q.kind, q.citations[0]?.rows])).toEqual([
        ["Q1", "prefixed_id", [5]],
        ["Q2", "negative_quantity", [5, 11]],
        ["Q3", "missing_id", [6, 9]],
      ]);
      // Each item states its row count through a SQL fact: one C-invoice, two negative quantities, two missing IDs.
      const counts = report.data_quality.map((q) => {
        const id = /\{\{(N\d+)\}\} rows/.exec(q.description)?.[1];
        const f = report.facts.find((x) => x.id === id);
        return [q.kind, f?.value, f?.computation.kind, f?.unit];
      });
      expect(counts).toEqual([
        ["prefixed_id", 1, "sql", "count"],
        ["negative_quantity", 2, "sql", "count"],
        ["missing_id", 2, "sql", "count"],
      ]);
      expect(report.verification.numbers_mismatched).toBe(0);
      expect(report.metrics.map((m) => m.id)).toEqual([
        "revenue",
        "orders",
        "units",
        "customers",
        "new_customers",
        "returning_customers",
        "aov",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

const REAL = join(import.meta.dirname, "..", "..", "real");
const fetched = missingRealData(join(REAL, "answers"), join(REAL, "data")).length === 0;

describe("typed errors", () => {
  it("an answer file for a dataset the manifest doesn't know, with no title, is UNKNOWN_DATASET", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-real-answers-"));
    try {
      writeFileSync(
        join(dir, "toy.yaml"),
        'dataset: toy\nfile: toy.csv\noptions: { today: "2026-10-16" }\nground_truth: []\nchecks: [{ id: C1, kind: completes, about: x }]\n',
      );
      await expect(
        runRealSuite({ model: () => baselineModel(), modelName: "baseline", embedder: hashEmbedder(), dataDir: dir, answersDir: dir }),
      ).rejects.toMatchObject({ name: "EvalRunError", code: "UNKNOWN_DATASET" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a real-data run with a file not fetched is NO_DATA, and writes nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-real-nodata-"));
    try {
      await expect(
        realEvalCommand(
          { model: "baseline", resultsDir: join(dir, "results"), dataDir: join(dir, "data"), answersDir: join(REAL, "answers") },
          { embedder: hashEmbedder(), print: () => {} },
        ),
      ).rejects.toMatchObject({ name: "EvalRunError", code: "NO_DATA" });
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("your own data (aa eval --suite real --answers <dir> --data <dir>)", () => {
  const EXAMPLES = join(import.meta.dirname, "..", "..", "..", "examples");

  it("runs an answer file with a title on your file: checksum of the file read, results marked as your data", async () => {
    const r = await runRealSuite({
      model: () => baselineModel(),
      modelName: "baseline",
      embedder: hashEmbedder(),
      dataDir: join(EXAMPLES, "coffee-roaster"),
      answersDir: join(EXAMPLES, "my-evals"),
    });
    const [d] = r.datasets;
    expect(d).toMatchObject({ dataset: "coffee-roaster", own: true, file: "sales-2026.xlsx", completed: true, publisher: "" });
    expect(d?.title).toMatch(/^Coffee roaster sales/);
    expect(d?.sha256).toBe(
      createHash("sha256")
        .update(readFileSync(join(EXAMPLES, "coffee-roaster", "sales-2026.xlsx")))
        .digest("hex"),
    );
    expect(d?.checks.map((c) => [c.id, c.pass])).toEqual([
      ["C1", true],
      ["C2", true],
      ["C3", true],
      ["C4", true],
      ["C5", true],
      ["C6", true],
    ]);
    const md = realResultsMarkdown(r);
    expect(md).toMatch(/^### baseline · your data · /);
    expect(md).toContain("#### Coffee roaster sales, Jan–Jun 2026 (the example workbook) (your data)");
  }, 120_000);

  it("names the folder it looked in when a file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-own-nodata-"));
    try {
      await expect(
        realEvalCommand(
          { model: "baseline", resultsDir: join(dir, "results"), dataDir: dir, answersDir: join(EXAMPLES, "my-evals") },
          { embedder: hashEmbedder(), print: () => {} },
        ),
      ).rejects.toThrow(`coffee-roaster in ${dir}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the published real-data results", () => {
  it("parses every answer file", () => {
    expect(loadRealAnswers(join(REAL, "answers")).map((a) => a.answers.dataset)).toEqual([
      "hotel-bookings",
      "montgomery-warehouse-sales",
      "nz-card-spend",
      "online-retail-ii",
    ]);
  });

  // CI has no downloaded data (it is never committed): this runs where `bun run eval:real:fetch` has been run.
  it.skipIf(!fetched)(
    "re-running the baseline reproduces every committed check result",
    async () => {
      const results = join(import.meta.dirname, "..", "..", "results");
      const file = readdirSync(results)
        .filter((f) => f.endsWith("-baseline-real.json"))
        .sort()
        .at(-1);
      if (!file) throw new Error("no committed baseline real-data results");
      const committed = JSON.parse(readFileSync(join(results, file), "utf8")) as RealSuiteResult;
      const r = await runRealSuite({
        model: () => baselineModel(),
        modelName: "baseline",
        embedder: hashEmbedder(),
        dataDir: join(REAL, "data"),
        answersDir: join(REAL, "answers"),
      });
      const outcome = (x: RealSuiteResult) =>
        x.datasets.map((d) => [d.dataset, d.completed, d.checks.map((c) => [c.id, c.pass, c.detail])]);
      expect(outcome(r)).toEqual(outcome(committed));
    },
    // About four minutes alone since the concentration pack covers every role column (M15 PR 11 prep: Montgomery
    // County's job alone is about 150 s), and longer beside the golden run inside the full suite.
    600_000,
  );
});
