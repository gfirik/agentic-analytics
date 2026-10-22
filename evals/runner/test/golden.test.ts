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
    // A refusal is a miss for an answerable question.
    expect(scoreGoldenItem(numeric({ kind: "ask" }, -7900), report([]), answer([], [], "no forecast")).pass).toBe(false);
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
    expect(scoreGoldenItem(trap, report([]), answer([fact("N1", "x", 1)], ["N1"])).pass).toBe(false);
    expect(scoreGoldenItem(trap, report([])).pass).toBe(false);
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

  it("is deterministic for a seed, and an interval that excludes 0 needs a consistent gain", () => {
    const a = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? 1 : 0));
    const b = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 || i % 2 === 0 ? 1 : 0));
    expect(pairedBootstrap(a, b)).toEqual(pairedBootstrap(a, b));
    expect(pairedBootstrap(a, b).low).toBeGreaterThan(0);
    // A gain on one task of forty in each direction: the interval straddles 0.
    const c = [...a];
    c[1] = 1;
    const d = [...a];
    d[0] = 0;
    expect(pairedBootstrap(c, d).low).toBeLessThan(0);
  });

  it("refuses unpaired or empty inputs", () => {
    expect(() => pairedBootstrap([1], [1, 2])).toThrowError(/paired/);
    expect(() => pairedBootstrap([], [])).toThrowError(/at least one/);
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

  it("each item's SQL gives its expected answer on the job's own tables (the independent re-derivation)", async () => {
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

  it("scores every reviewed item as passing, and the unreviewed one is not counted", async () => {
    const scores: GoldenScore[] = [];
    for (const item of set.items) {
      const a = item.source.kind === "ask" ? await askJob(dir, item.question, coffeePlanner()) : undefined;
      scores.push(scoreGoldenItem(item, r, a));
    }
    for (const s of scores.filter((x) => x.counts)) expect(s.pass, `${s.id}: ${s.got}`).toBe(true);
    expect(summarizeGolden(scores)).toMatchObject({ numericCategorical: { passed: 4, of: 4 }, traps: { passed: 1, of: 1 }, notCounted: 1 });
  }, 120_000);
});
