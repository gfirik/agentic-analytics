// `aa eval --repeat N` (docs/specs/accuracy.md §7): the five agreement measures of analyst-grade §4.3, hand-computed
// on scripted snapshots, and the CI path: a FakeModel whose second run answers differently, so the measures are
// checked on known disagreements, offline.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeModel } from "@agentic-analytics/models/testing";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import type { Report } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import {
  baselineScript,
  consistency,
  EvalRunError,
  evalMatrix,
  evalRepeat,
  findingGrade,
  findingKey,
  type JobSnapshot,
  jobAgreement,
  matrixLines,
  repeatMarkdown,
  repeatPassed,
  snapshotOf,
} from "../src/index.ts";

const finding = (key: string, driver = "Acme", grade = "correlated") => ({ key, driver, grade });
const snap = (dataset: string, o: Partial<JobSnapshot> = {}): JobSnapshot => ({
  dataset,
  completed: true,
  facts: { "revenue_2026-03": [100], "revenue_2026-04": [80] },
  findings: [finding("change.v1 · revenue · 2026-04 · (all)"), finding("anomaly.v1 · orders · 2026-04 · (all)", "none", "observed")],
  action: "recover_share",
  ...o,
});

describe("agreement measures (hand-computed)", () => {
  // Four jobs × three runs:
  // A: every run the same → agrees on all five.
  // B: run 2 has revenue_2026-04 = 81 (a); run 3 swaps the orders finding for a refund_rate one (b); run 2's revenue
  //    finding names another driver (c); grades the same (d); run 3 has no recommendation (e).
  // C: run 2 failed → disagrees on all five.
  // D: no findings and no recommendation in any run → (a), (b), (e) agree; (c), (d) n/a.
  const A = [snap("A"), snap("A"), snap("A")];
  const B = [
    snap("B"),
    snap("B", {
      facts: { "revenue_2026-03": [100], "revenue_2026-04": [81] },
      findings: [
        finding("change.v1 · revenue · 2026-04 · (all)", "Beta"),
        finding("anomaly.v1 · orders · 2026-04 · (all)", "none", "observed"),
      ],
    }),
    snap("B", {
      findings: [
        finding("change.v1 · revenue · 2026-04 · (all)"),
        finding("change.v1 · refund_rate · 2026-04 · (all)", "none", "observed"),
      ],
      action: "none",
    }),
  ];
  const C = [snap("C"), { dataset: "C", completed: false, facts: {}, findings: [], action: "none" }, snap("C")];
  const D = [0, 1, 2].map(() => snap("D", { findings: [], action: "none" }));

  it("decides each job per measure", () => {
    expect(jobAgreement(A).agreement.agree).toEqual({ numbers: true, findings: true, driver: true, grade: true, action: true });
    expect(jobAgreement(B).agreement.agree).toEqual({ numbers: false, findings: false, driver: false, grade: true, action: false });
    expect(jobAgreement(C).agreement.agree).toEqual({ numbers: false, findings: false, driver: false, grade: false, action: false });
    expect(jobAgreement(D).agreement.agree).toEqual({ numbers: true, findings: true, driver: null, grade: null, action: true });
  });

  it("reports the share of jobs where every run agrees, n/a jobs left out", () => {
    const c = consistency([A, B, C, D]);
    // numbers A, D of 4; findings A, D of 4; driver A of A–C (D n/a); grade A, B of A–C; action A, D of 4.
    expect(c.measures.map((m) => [m.measure, m.agreeing, m.of, m.share, m.pass])).toEqual([
      ["numbers", 2, 4, 0.5, false],
      ["findings", 2, 4, 0.5, false],
      ["driver", 1, 3, 1 / 3, false],
      ["grade", 2, 3, 2 / 3, false],
      ["action", 2, 4, 0.5, false],
    ]);
    expect(consistency([A, D]).measures.every((m) => m.pass === true)).toBe(true);
    expect(consistency([D]).measures.find((m) => m.measure === "driver")).toEqual({ measure: "driver", agreeing: 0, of: 0, bar: 0.95 });
  });

  it("writes each disagreement side by side, one cell per run", () => {
    expect(consistency([A, B, C, D]).disagreements).toEqual([
      { dataset: "B", measure: "numbers", item: "revenue_2026-04", runs: ["80", "81", "80"] },
      { dataset: "B", measure: "findings", item: "anomaly.v1 · orders · 2026-04 · (all)", runs: ["#2", "#2", "—"] },
      { dataset: "B", measure: "findings", item: "change.v1 · refund_rate · 2026-04 · (all)", runs: ["—", "—", "#2"] },
      { dataset: "B", measure: "driver", item: "change.v1 · revenue · 2026-04 · (all)", runs: ["Acme", "Beta", "Acme"] },
      { dataset: "B", measure: "action", item: "top recommendation", runs: ["recover_share", "recover_share", "none"] },
      { dataset: "C", measure: "job", item: "job finished", runs: ["yes", "failed", "yes"] },
    ]);
  });

  it("compares a fact label only across the runs that have it, and top-5 findings regardless of rank order", () => {
    const extra = snap("E", { facts: { "revenue_2026-03": [100], "revenue_2026-04": [80], "I9 change.v1 revenue 2026-04:change": [-20] } });
    const swapped = snap("E", { findings: [...snap("E").findings].reverse() });
    expect(jobAgreement([snap("E"), extra, swapped]).agreement.agree).toEqual({
      numbers: true,
      findings: true,
      driver: true,
      grade: true,
      action: true,
    });
  });
});

describe("snapshotOf", () => {
  const fact = (id: string, label: string, value: number, fn?: string) => ({
    id,
    label,
    value,
    unit: "currency",
    computation: fn ? { kind: "function", fn } : { kind: "sql", sql: "select 1" },
    citations: [],
    verified: true,
  });
  const report = {
    metrics: [],
    facts: [
      fact("N1", "revenue_2026-03", 100),
      fact("N2", "revenue_2026-04", 80),
      fact("N3", "I1 change.v1 revenue 2026-04:change", -20, "change"),
      fact("N4", "revenue[customer=Acme]_2026-04", 5),
      fact("N5", "revenue[customer=Acme]_2026-03", 25),
      fact("N6", "param_low", 30, "scenario_param"),
      fact("N7", "low scenario estimate", 6, "impact.v1:recover_share"),
    ],
    findings: [
      {
        id: "F1",
        type: "regression",
        claims: [
          { text: "", facts: ["N3", "N1", "N2"], citations: [], verified: true },
          { text: "", facts: [], citations: [], causal_grade: "document_supported", verified: true },
          { text: "", facts: [], citations: [], causal_grade: "correlated", verified: true },
        ],
        drivers: [{ label: " Acme ", fact: "N4", share_of_change: "N4" }],
      },
      { id: "F2", type: "anomaly", claims: [{ text: "", facts: ["N5", "N4"], citations: [], verified: true }] },
    ],
    recommendations: [{ impact: { method: "impact.v1:recover_share" } }],
  } as unknown as Report;

  it("keys a finding by template, metric concept, period and member, and grades it by its highest claim", () => {
    const [f1, f2] = report.findings as [Report["findings"][number], Report["findings"][number]];
    expect(findingKey(f1, report)).toBe("change.v1 · revenue · 2026-04 · (all)");
    // No insight fact: the finding type stands in for the template; the member is the scorer's.
    expect(findingKey(f2, report)).toBe("anomaly · revenue · 2026-04 · customer=Acme");
    expect(findingGrade(f1)).toBe("document_supported");
    expect(findingGrade(f2)).toBe("observed");
  });

  it("keeps the deterministic facts, the top findings and the top scenario; leaves scenario facts to (e)", () => {
    const s = snapshotOf("x", report);
    expect(Object.keys(s.facts)).toEqual([
      "revenue_2026-03",
      "revenue_2026-04",
      "I1 change.v1 revenue 2026-04:change",
      "revenue[customer=Acme]_2026-04",
      "revenue[customer=Acme]_2026-03",
    ]);
    expect(s.findings).toEqual([
      { key: "change.v1 · revenue · 2026-04 · (all)", driver: "Acme", grade: "document_supported" },
      { key: "anomaly · revenue · 2026-04 · customer=Acme", driver: "none", grade: "observed" },
    ]);
    expect(s.action).toBe("recover_share");
    expect(snapshotOf("x", undefined)).toEqual({ dataset: "x", completed: false, facts: {}, findings: [], action: "none" });
  });
});

describe("evalRepeat (CI path: scripted variation)", () => {
  // Run 2's planner writes no explanation and proposes no action; runs 1 and 3 are the baseline. The facts and the
  // findings come from code, so (a) and (b) still agree; the grade (d) and the top action (e) don't.
  const variant = () =>
    new FakeModel([
      { role: "planner", match: "Propose the candidate actions", repeat: true, object: { candidates: [] } },
      {
        role: "planner",
        match: /Write the explanation|Fill the form/,
        repeat: true,
        object: {
          title: "A change with no stated cause",
          explanations: [],
          alternatives_rejected: [],
          confidence: "low",
          confidence_reasons: ["No document explains this change."],
        },
      },
      ...baselineScript(),
    ]);

  it("measures known disagreements and writes them side by side", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-repeat-"));
    let run = 0;
    const out: string[] = [];
    const r = await evalRepeat(
      { suite: "smoke", model: "scripted-variation", repeat: 3, only: ["coffee_roaster-v1"], resultsDir: dir },
      {
        embedder: hashEmbedder(),
        print: (l) => out.push(l),
        now: () => new Date("2026-10-22T12:00:00Z"),
        // One dataset per run, so the nth client is the nth run.
        modelFor: () => (++run === 2 ? variant() : new FakeModel(baselineScript())),
      },
    );
    expect(run).toBe(3);
    expect(r.runs.map((x) => [x.finished, x.of])).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
    const share = Object.fromEntries(r.measures.map((m) => [m.measure, m.share]));
    expect(share).toMatchObject({ numbers: 1, findings: 1, grade: 0, action: 0 });
    const measured = new Set(r.disagreements.map((d) => d.measure));
    expect([...measured].sort()).toEqual(["action", "grade"]);
    // Side by side: runs 1 and 3 agree, run 2 differs.
    for (const d of r.disagreements) {
      expect(d.runs).toHaveLength(3);
      expect(d.runs[0]).toBe(d.runs[2]);
      expect(d.runs[1]).not.toBe(d.runs[0]);
    }
    expect(r.disagreements.find((d) => d.measure === "action")?.runs[1]).toBe("none");
    expect(repeatPassed(r)).toBe(false);
    const base = join(dir, "repeat", "2026-10-22-scripted-variation-smoke-repeat3");
    expect(JSON.parse(readFileSync(`${base}.json`, "utf8"))).toEqual(JSON.parse(JSON.stringify(r)));
    const md = readFileSync(`${base}.md`, "utf8");
    expect(md).toBe(repeatMarkdown(r));
    expect(md).toContain("| Dataset | Measure | Item | Run 1 | Run 2 | Run 3 |");
    expect(out).toContain(`results: ${base}.json`);
  }, 300_000);

  it("agrees on every measure when every run is the baseline, and refuses fewer than two runs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-repeat-"));
    const r = await evalRepeat(
      { suite: "smoke", model: "baseline", repeat: 2, only: ["coffee_roaster-v1"], resultsDir: dir },
      { embedder: hashEmbedder(), print: () => {} },
    );
    expect(r.cache).toBe("n/a");
    expect(r.measures.every((m) => m.share === 1)).toBe(true);
    expect(r.disagreements).toEqual([]);
    expect(repeatPassed(r)).toBe(true);
    // A run that served calls from the cache overstates agreement, so it fails whatever its measures say.
    expect(repeatPassed({ ...r, cache: "on" })).toBe(false);
    await expect(
      evalRepeat({ suite: "smoke", model: "baseline", repeat: 1, resultsDir: dir }, { embedder: hashEmbedder(), print: () => {} }),
    ).rejects.toThrow(EvalRunError);
  }, 300_000);

  it("runs --repeat per model in the matrix, each with its own agreement line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-repeat-"));
    const runs = await evalMatrix(
      ["baseline", "openai-compatible:groq:scripted"],
      { suite: "smoke", repeat: 2, only: ["coffee_roaster-v1"], resultsDir: dir },
      { embedder: hashEmbedder(), print: () => {}, modelFor: () => new FakeModel(baselineScript()) },
    );
    expect(runs.map((r) => [r.model, r.repeat?.repeat, r.result])).toEqual([
      ["baseline", 2, undefined],
      ["openai-compatible:groq:scripted", 2, undefined],
    ]);
    expect(runs[1]?.repeat?.cache).toBe("off");
    expect(matrixLines(runs)).toEqual([
      "baseline: 2 runs, every run agrees on numbers 100.0%, findings 100.0%, driver 100.0%, grade 100.0%, action 100.0% of jobs",
      "openai-compatible:groq:scripted: 2 runs, every run agrees on numbers 100.0%, findings 100.0%, driver 100.0%, grade 100.0%, action 100.0% of jobs",
    ]);
  }, 300_000);
});
