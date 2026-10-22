// The golden-set scorer and the paired bootstrap (docs/specs/accuracy.md §1–§3, §5), with hand-computed cases, and
// the CI mini set run end to end on the committed coffee-roaster dataset with the scripted planner.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Answer, askJob, runJob } from "@agentic-analytics/core";
import { coffeePlanner } from "@agentic-analytics/core/testing";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import type { Fact, Report } from "@agentic-analytics/schema";
import { Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type GoldenItem,
  type GoldenScore,
  pairedBootstrap,
  parseGoldenSet,
  scoreGoldenItem,
  summarizeGolden,
  withinTolerance,
} from "../src/index.ts";

const fact = (id: string, label: string, value: number): Fact =>
  ({ id, label, value, unit: "currency", computation: { kind: "sql", sql: "SELECT 1" }, citations: [], verified: true }) as Fact;
const report = (facts: Fact[], findings: Report["findings"] = []) => ({ facts, findings }) as unknown as Report;
const answer = (facts: Fact[], cite: string[], notCovered?: string): Answer => ({
  question: "q",
  claims: cite.length ? [{ text: "x", facts: cite, citations: [], verified: true } as Answer["claims"][number]] : [],
  facts,
  dropped: [],
  ...(notCovered ? { notCovered } : {}),
});
const reviewed = { reviewed_by: "agent (autonomous mode)", date: "2026-10-22", method: "independent_sql", agrees: true } as const;
const numeric = (source: GoldenItem["source"], expected: number, tol = { abs: 0, rel: 0 }): GoldenItem => ({
  id: "G1",
  question: "What was revenue in April?",
  kind: "numeric",
  expected,
  tolerance: tol,
  source,
  columns: [],
  split: "dev",
  review: reviewed,
});

describe("golden scorer", () => {
  it("tolerance: absolute or relative, a tolerance of 0 is exact", () => {
    expect(withinTolerance(100.4, 100, { abs: 0.5, rel: 0 })).toBe(true);
    expect(withinTolerance(100.6, 100, { abs: 0.5, rel: 0 })).toBe(false);
    expect(withinTolerance(101, 100, { abs: 0, rel: 0.01 })).toBe(true); // |1| ≤ 0.01 × 100
    expect(withinTolerance(101.5, 100, { abs: 0, rel: 0.01 })).toBe(false);
    expect(withinTolerance(-7900, -7900, { abs: 0, rel: 0 })).toBe(true);
  });

  it("a fact item compares only the named fact: an unrelated fact with the right value scores nothing", () => {
    const r = report([fact("N1", "revenue_2026-04", 36200), fact("N2", "orders_2026-04", 44100)]);
    expect(scoreGoldenItem(numeric({ kind: "fact", label: "revenue_2026-04" }, 36200), r).pass).toBe(true);
    // 44,100 is in the report, but as orders, not March revenue: the item names revenue_2026-03, which is absent.
    const miss = scoreGoldenItem(numeric({ kind: "fact", label: "revenue_2026-03" }, 44100), r);
    expect(miss).toMatchObject({ pass: false, got: "no fact revenue_2026-03" });
  });

  it("an ask item passes on a cited fact only, never on an uncited one in the answer", () => {
    const facts = [fact("N1", "x", -7900), fact("N2", "y", 36200)];
    expect(scoreGoldenItem(numeric({ kind: "ask" }, -7900), report([]), answer(facts, ["N1"])).pass).toBe(true);
    expect(scoreGoldenItem(numeric({ kind: "ask" }, -7900), report([]), answer(facts, ["N2"])).pass).toBe(false);
    // A refusal is a miss for an answerable question; a caveat beside the right cited fact is still a pass.
    expect(scoreGoldenItem(numeric({ kind: "ask" }, -7900), report([]), answer([], [], "no forecast")).pass).toBe(false);
    expect(scoreGoldenItem(numeric({ kind: "ask" }, -7900), report([]), answer(facts, ["N1"], "the May data is partial")).pass).toBe(true);
  });

  it("a trap passes only on a structured refusal (notCovered or no verified claim), never on free text", () => {
    const trap: GoldenItem = {
      id: "G9",
      question: "What is the margin?",
      kind: "trap",
      reason: "no cost column",
      source: { kind: "ask" },
      columns: [],
      split: "dev",
      review: reviewed,
    };
    expect(scoreGoldenItem(trap, report([]), answer([], [], "The data has no cost column.")).pass).toBe(true);
    expect(scoreGoldenItem(trap, report([]), answer([], [])).pass).toBe(true);
    // A caveat beside verified claims is not a refusal: the trap is missed.
    expect(scoreGoldenItem(trap, report([]), answer([fact("N1", "x", 1)], ["N1"], "partly covered")).pass).toBe(false);
    expect(scoreGoldenItem(trap, report([]), answer([fact("N1", "x", 1)], ["N1"])).pass).toBe(false);
    expect(scoreGoldenItem(trap, report([])).pass).toBe(false);
  });

  it("a driver item reads the finding whose change is at that period, not one that only cites the period", () => {
    // F1: revenue March → April (its first claim cites both points and the change), top driver wholesale.
    const facts = [
      fact("N1", "revenue_2026-03", 44100),
      fact("N2", "revenue_2026-04", 36200),
      fact("N3", "I1 period_change revenue 2026-04:change", -7900),
    ];
    const f1 = {
      id: "F1",
      claims: [{ text: "x", facts: ["N1", "N2", "N3"], citations: [], verified: true }],
      drivers: [{ label: "“wholesale”", fact: "N3", share_of_change: "N3" }],
    } as unknown as Report["findings"][number];
    const r = report(facts, [f1]);
    const driver = (period: string, expected: string): GoldenItem => ({
      id: "G2",
      question: "Which channel drove it?",
      kind: "categorical",
      expected,
      source: { kind: "driver", metric: "revenue", period },
      columns: [],
      split: "dev",
      review: reviewed,
    });
    expect(scoreGoldenItem(driver("2026-04", "wholesale"), r)).toMatchObject({ pass: true, got: "wholesale" });
    // March is only the before side of F1: no finding is at March.
    expect(scoreGoldenItem(driver("2026-03", "wholesale"), r)).toMatchObject({ pass: false, got: "no finding on revenue at 2026-03" });
    expect(scoreGoldenItem(driver("2026-04", "retail"), r).pass).toBe(false);
  });

  it("a categorical ask item needs exactly one member among the first claim's facts", () => {
    const cat: GoldenItem = {
      id: "G3",
      question: "Which channel?",
      kind: "categorical",
      expected: "wholesale",
      source: { kind: "ask" },
      columns: [],
      split: "dev",
      review: reviewed,
    };
    const w = fact("N1", "revenue[channel=wholesale]_2026-04", 7400);
    const rt = fact("N2", "revenue[channel=retail]_2026-04", 28800);
    const total = fact("N3", "revenue_2026-04", 36200);
    expect(scoreGoldenItem(cat, report([]), answer([w, total], ["N1", "N3"])).pass).toBe(true);
    expect(scoreGoldenItem(cat, report([]), answer([rt, total], ["N2", "N3"])).pass).toBe(false);
    // Citing every channel names no single answer.
    expect(scoreGoldenItem(cat, report([]), answer([w, rt], ["N1", "N2"]))).toMatchObject({
      pass: false,
      got: "several members: wholesale, retail",
    });
    expect(scoreGoldenItem(cat, report([]), answer([total], ["N3"]))).toMatchObject({ pass: false, got: "no member cited" });
  });

  it("summarizes one split at a time when asked", () => {
    const s = (split: GoldenScore["split"], pass: boolean): GoldenScore => ({
      id: "G",
      kind: "numeric",
      split,
      pass,
      got: "",
      counts: true,
    });
    const scores = [s("dev", true), s("heldout", false), s("heldout", true)];
    expect(summarizeGolden(scores, "heldout").numericCategorical).toEqual({ passed: 1, of: 2 });
    expect(summarizeGolden(scores, "dev").numericCategorical).toEqual({ passed: 1, of: 1 });
  });

  it("counts only reviewed items whose re-derivation agrees", () => {
    const s = (pass: boolean, kind: GoldenScore["kind"], counts: boolean): GoldenScore => ({
      id: "G",
      kind,
      split: "dev",
      pass,
      got: "",
      counts,
    });
    const sum = summarizeGolden([
      s(true, "numeric", true),
      s(false, "categorical", true),
      s(true, "trap", true),
      s(true, "numeric", false),
    ]);
    expect(sum).toEqual({ numericCategorical: { passed: 1, of: 2 }, traps: { passed: 1, of: 1 }, notCounted: 1 });
  });

  it("a golden file is validated: duplicate ids and a trap read from a fact are refused", () => {
    expect(() =>
      parseGoldenSet(
        "dataset: d\nitems:\n  - { id: G1, question: Revenue in April?, kind: trap, reason: not answerable, source: { kind: fact, label: x }, split: dev }",
      ),
    ).toThrowError(/a trap is answered through ask/);
    expect(() =>
      parseGoldenSet(
        "dataset: d\nitems:\n  - { id: G1, question: Revenue in April?, kind: numeric, expected: 1, source: { kind: ask }, split: dev }\n  - { id: G1, question: Revenue in May?, kind: numeric, expected: 2, source: { kind: ask }, split: dev }",
      ),
    ).toThrowError(/duplicate id G1/);
    expect(() =>
      parseGoldenSet(
        "dataset: d\nitems:\n  - { id: G1, question: Revenue in April?, kind: numeric, expected: 1, source: { kind: driver, metric: r, period: p }, split: dev }",
      ),
    ).toThrowError(/a driver answers categorical items only/);
    expect(() =>
      parseGoldenSet(
        "dataset: d\nitems:\n  - { id: G1, question: Which channel?, kind: categorical, expected: w, source: { kind: fact, label: x }, split: dev }",
      ),
    ).toThrowError(/a fact answers numeric items only/);
  });
});

describe("paired bootstrap", () => {
  it("a constant difference has that difference as its mean and both ends of its interval", () => {
    const r = pairedBootstrap([0, 0, 1, 1], [1, 1, 2, 2]);
    expect(r).toMatchObject({ mean: 1, low: 1, high: 1, resamples: 10_000 });
  });

  it("no difference gives [0, 0]; the mean is the plain mean of b − a", () => {
    expect(pairedBootstrap([1, 0, 1], [1, 0, 1])).toMatchObject({ mean: 0, low: 0, high: 0 });
    // b − a = [1, 1, 0, 1] → mean 0.75 by hand; the interval lies within [0, 1] and contains the mean.
    const r = pairedBootstrap([0, 0, 1, 0], [1, 1, 1, 1]);
    expect(r.mean).toBe(0.75);
    expect(r.low).toBeGreaterThanOrEqual(0);
    expect(r.high).toBeLessThanOrEqual(1);
    expect(r.low).toBeLessThanOrEqual(0.75);
    expect(r.high).toBeGreaterThanOrEqual(0.75);
  });

  it("a hand-computable case: b − a = [0, 1] resamples to means 0, 0.5, 1 (¼, ½, ¼), so the interval is [0, 1]", () => {
    expect(pairedBootstrap([0, 0], [0, 1])).toMatchObject({ mean: 0.5, low: 0, high: 1 });
  });

  it("is deterministic for a seed; an interval excludes 0 only for a consistent gain", () => {
    const a = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? 1 : 0));
    const b = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 || i % 2 === 0 ? 1 : 0));
    // b − a is 1 where i is even and not a multiple of 3: i ∈ {2, 4, 8, 10, …, 38}, 13 tasks → mean 13/40 = 0.325.
    expect(pairedBootstrap(a, b).mean).toBe(0.325);
    expect(pairedBootstrap(a, b)).toEqual(pairedBootstrap(a, b));
    expect(pairedBootstrap(a, b).low).toBeGreaterThan(0);
    // One gain and one loss over forty tasks (differences +1 and −1, the rest 0): the interval straddles 0.
    const d = [...a];
    d[1] = 1;
    d[0] = 0;
    const r = pairedBootstrap(a, d);
    expect(r.mean).toBe(0);
    expect(r.low).toBeLessThan(0);
    expect(r.high).toBeGreaterThan(0);
  });

  it("refuses unpaired or empty inputs", () => {
    expect(() => pairedBootstrap([1], [1, 2])).toThrowError(/paired/);
    expect(() => pairedBootstrap([], [])).toThrowError(/at least one/);
    expect(() => pairedBootstrap([1], [1], { resamples: 0 })).toThrowError(/resamples/);
    expect(() => pairedBootstrap([Number.NaN], [1])).toThrowError(/finite/);
  });
});

describe("the CI mini golden set on coffee-roaster (scripted planner)", () => {
  const set = parseGoldenSet(readFileSync(join(import.meta.dirname, "..", "..", "golden", "coffee-roaster", "golden.yaml"), "utf8"));
  const dir = mkdtempSync(join(tmpdir(), "aa-golden-"));
  let r: Report;
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  beforeAll(async () => {
    const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
    r = (
      await runJob({ dir, files, options: { today: "2026-07-01", currency: "USD" } }, { model: coffeePlanner(), embedder: hashEmbedder() })
    ).report;
  }, 180_000);

  it("each item's SQL gives its expected answer on the job's own tables (a fixture check, sharing the engine's ingest)", async () => {
    const ws = await Workspace.open(join(dir, "job.duckdb"));
    try {
      for (const item of set.items) {
        if (!item.sql || item.kind === "trap") continue;
        const row = await ws.one<Record<string, unknown>>({ text: item.sql, params: [] });
        const got = Object.values(row ?? {})[0];
        if (item.kind === "numeric") expect(Number(got), item.id).toBeCloseTo(item.expected, 6);
        else expect(String(got), item.id).toBe(item.expected);
      }
    } finally {
      ws.close();
    }
  });

  it("scores the fixture's items with the scripted run, and none of them counts toward the bars", async () => {
    const scores: GoldenScore[] = [];
    for (const item of set.items) {
      const a = item.source.kind === "ask" ? await askJob(dir, item.question, coffeePlanner()) : undefined;
      scores.push(scoreGoldenItem(item, r, a));
    }
    // Every item the scripted run can answer passes (G6 asks for a fact the report doesn't carry).
    expect(scores.filter((x) => !x.pass).map((x) => x.id)).toEqual(["G6"]);
    // A fixture, not reviewed: nothing here counts toward the bars.
    expect(summarizeGolden(scores)).toMatchObject({ numericCategorical: { passed: 0, of: 0 }, traps: { passed: 0, of: 0 }, notCounted: 6 });
  }, 120_000);
});
