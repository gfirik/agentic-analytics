// The scripted ablation end to end (accuracy.md §8, the CI path of m14.md item 6): FakeModel arms A and B on the
// smoke suite and on the CI mini golden set, arm C with the scripted planner on the mini set, the measures and
// paired intervals, and the per-run folders gone afterwards. Expected values are worked out from the canned answers
// (src/scripted.ts) and the keys, in the comments.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { afterAll, describe, expect, it } from "vitest";
import {
  type AblationResult,
  ablationArgs,
  ablationCommand,
  ablationMarkdown,
  coffeeGoldenJob,
  runAblation,
  scriptedClient,
  smokeJobs,
} from "../src/index.ts";

const work = mkdtempSync(join(tmpdir(), "aa-ablation-run-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const measure = (r: AblationResult, arm: string) => r.measures.find((m) => m.arm === arm);

describe("the mini golden set (coffee-roaster), arms A, B and C scripted", () => {
  let r: AblationResult;
  it("scores every arm on the same six items", async () => {
    r = await runAblation({
      suite: "golden",
      arms: ["A", "B", "C"],
      jobs: [coffeeGoldenJob()],
      model: "baseline",
      scripted: true,
      contextTokens: 32_768,
      tools: true,
      client: scriptedClient,
      embedder: hashEmbedder(),
      workDir: work,
    });
    // A: G1 right (even index), G2/G4/G6 10% off, G3 the expected member, the trap G5 answered → 1/4, 1/1, 0/1.
    expect(measure(r, "A")).toMatchObject({ numeric: { n: 1, of: 4 }, categorical: { n: 1, of: 1 }, traps: { n: 0, of: 1 } });
    // B: G1, G2, G4 from their own SQL, G3's SQL gives "wholesale", G5 refused after a refused read; G6 has no SQL → 3/4.
    expect(measure(r, "B")).toMatchObject({ numeric: { n: 3, of: 4 }, categorical: { n: 1, of: 1 }, traps: { n: 1, of: 1 } });
    // C: the scripted planner answers all six; G6 (May's revenue) since M15 PR 10, when the scorecard's mean put every
    // month's revenue fact in the report (golden.test.ts).
    expect(measure(r, "C")).toMatchObject({ numeric: { n: 4, of: 4 }, categorical: { n: 1, of: 1 }, traps: { n: 1, of: 1 } });
  }, 120_000);

  it("unsupported numbers and citation validity (hand-computed from the canned answers)", () => {
    // A claims 36,200 (golden), 48,510, −8,690, 39,380 (each 10% off) and 512,000 (the trap). 39,380 lies within the 0.5%
    // support tolerance of arm C's scorecard mean of revenue, 237,200 ÷ 6 = 39,533.33 (off by 0.39%), so it counts as
    // supported by chance: 3 of 5 unsupported without cells. B claims 36,200, 44,100 and −7,900, all golden: 0 of 3.
    expect(measure(r, "A")?.unsupported).toMatchObject({ numbers: 5, unsupportedWithoutCells: 3 });
    expect(measure(r, "A")?.unsupported?.unsupported).toBeLessThanOrEqual(4);
    expect(measure(r, "B")?.unsupported).toEqual({ numbers: 3, unsupported: 0, unsupportedWithoutCells: 0 });
    // B's three numeric answers cite the statement they ran, which re-runs to the same rows: 3 of 3 valid.
    expect(measure(r, "B")?.citations).toEqual({ n: 3, of: 3 });
    // The trap's refused read is in B's query log as a typed tool error.
    const g5 = r.results.find((x) => x.arm === "B")?.tasks.find((t) => t.task === "G5");
    expect(g5?.queries?.[0]?.error?.code).toBe("SQL_REFUSED");
  });

  it("pairs the arms by task with a bootstrap interval; arm A's cut is stated beside its results", () => {
    // Per task (G1..G6): A = 1,0,1,0,0,0; B = 1,1,1,1,1,0; C = 1,1,1,1,1,1. C − A: mean 4/6; C − B: 1/6; B − A: 3/6.
    expect(r.comparisons.map((c) => [c.pair, c.tasks, c.difference.mean])).toEqual([
      ["C − A", 6, 4 / 6],
      ["C − B", 6, 1 / 6],
      ["B − A", 6, 0.5],
    ]);
    // C − B differs on one task (G6), so its bootstrap interval runs from 0 to a half and does not clear 0.
    expect(r.comparisons[1]?.difference).toMatchObject({ low: 0, high: 0.5 });
    expect(r.comparisons[1]?.adds).toBe(false);
    const md = ablationMarkdown(r);
    expect(md).toContain("Harness check, not an engine-vs-model comparison");
    expect(md).toMatch(/Arm A saw a sample\..*t_t1 \(sales-2026\.xlsx#Orders\) shows rows 1–\d+ of 6260/);
    expect(md).not.toContain("| yes (interval above 0) |");
  });

  it("arm B's per-run database and temp directory are deleted after the run", () => {
    expect(r.results.find((x) => x.arm === "B")?.cleanedUp).toBe(true);
    expect(readdirSync(work)).toEqual([]);
  });
});

describe("the smoke suite, arms A and B scripted", () => {
  it("maps each answer to planted events with the eval's subject matcher", async () => {
    const r = await runAblation({
      suite: "smoke",
      arms: ["A", "B"],
      jobs: smokeJobs(),
      model: "baseline",
      scripted: true,
      contextTokens: 32_768,
      tools: true,
      client: scriptedClient,
      embedder: hashEmbedder(),
      workDir: work,
    });
    // The smoke keys have 5 planted events (3 with an expected driver) and 5 distractors over 3 datasets.
    // A reports every planted event with no driver and each dataset's first distractor: found = the 2 without an
    // expected driver (2/5), drivers 0/3, distractors 3/5.
    expect(measure(r, "A")).toMatchObject({ recall5: { n: 2, of: 5 }, driver: { n: 0, of: 3 }, distractorFp: { n: 3, of: 5 } });
    // B reports each dataset's first planted event with its driver (each has one): 3/5, drivers 3/3, no distractors.
    expect(measure(r, "B")).toMatchObject({ recall5: { n: 3, of: 5 }, driver: { n: 3, of: 3 }, distractorFp: { n: 0, of: 5 } });
    expect(r.comparisons.map((c) => [c.pair, c.tasks])).toEqual([["B − A", 5]]);
    expect(r.results.filter((x) => x.arm === "B").every((x) => x.cleanedUp)).toBe(true);
    // Every smoke dataset is larger than the window: arm A's results carry each cut.
    expect(measure(r, "A")?.cuts).toHaveLength(3);
  }, 120_000);

  it("a model that can't call tools runs arm A only", async () => {
    const r = await runAblation({
      suite: "smoke",
      arms: ["A", "B", "C"],
      jobs: smokeJobs("coffee_roaster-v1"),
      model: "baseline",
      scripted: true,
      contextTokens: 32_768,
      tools: false,
      client: scriptedClient,
      embedder: hashEmbedder(),
      workDir: work,
    });
    expect(r.results.map((x) => x.arm)).toEqual(["A"]);
    expect(measure(r, "B")).toMatchObject({ ran: false, skipped: expect.stringMatching(/can't call tools/) });
    expect(measure(r, "C")).toMatchObject({ ran: false, skipped: expect.stringMatching(/can't call tools/) });
  }, 60_000);
});

describe("the command", () => {
  const defaults = { resultsDir: "/r", dataDir: "/d", answersDir: "/a" };
  it("checks its flags", () => {
    expect(ablationArgs({}, defaults)).toMatchObject({
      arms: ["A", "B", "C"],
      suite: "smoke",
      model: "baseline",
      contextTokens: 32_768,
      tools: true,
    });
    expect(ablationArgs({ arms: "a,c", suite: "golden", "no-tools": true, context: "8192" }, defaults)).toMatchObject({
      arms: ["A", "C"],
      suite: "golden",
      tools: false,
      contextTokens: 8192,
    });
    expect(() => ablationArgs({ arms: "A,D" }, defaults)).toThrow(/--arms/);
    expect(() => ablationArgs({ suite: "full" }, defaults)).toThrow(/--suite/);
    expect(() => ablationArgs({ model: "configured" }, defaults)).toThrow(/not configured/);
    expect(() => ablationArgs({ context: "12.5" }, defaults)).toThrow(/--context/);
  });

  it("writes the JSON and the page under <results>/ablation, and prints the measures", async () => {
    const out = mkdtempSync(join(tmpdir(), "aa-ablation-out-"));
    try {
      const lines: string[] = [];
      const { files } = await ablationCommand(
        { ...ablationArgs({ arms: "A,B", suite: "golden", dataset: "coffee-roaster" }, defaults), resultsDir: out },
        { env: {}, embedder: hashEmbedder(), print: (l) => lines.push(l), now: () => new Date("2026-10-22T12:00:00Z") },
      );
      expect(files.map((f) => f.slice(out.length))).toEqual([
        "/ablation/2026-10-22-baseline-golden-coffee-roaster.json",
        "/ablation/2026-10-22-baseline-golden-coffee-roaster.md",
      ]);
      expect(JSON.parse(readFileSync(files[0] as string, "utf8"))).toMatchObject({ suite: "golden", scripted: true, arms: ["A", "B"] });
      expect(lines.join("\n")).toMatch(/Numeric accuracy\s+25% \(1\/4\)\s+75% \(3\/4\)/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});
