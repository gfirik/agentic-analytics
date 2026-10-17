// `aa eval --label/--note/--only` (docs/EVALS.md §3): a self-hosted run (the Kaggle vLLM notebook,
// evals/kaggle/full-suite-vllm.ipynb) is published as its own model row, and a long run can go in chunks.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Dataset } from "@agentic-analytics/eval-generator";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { describe, expect, it } from "vitest";
import { EvalRunError, evalCommand, evalSlug, mergeResults, resultsPage, type SuiteResult, selectDatasets } from "../src/index.ts";

const LABEL = "vllm (Kaggle 2×T4) Qwen3.8-27B-AWQ";

describe("evalSlug", () => {
  it("keeps the old file name for a model, and slugs a label", () => {
    expect(evalSlug("2026-10-17", { model: "configured", suite: "full", smallModel: true })).toBe("2026-10-17-configured-small-full");
    expect(evalSlug("2026-10-16", { model: "openai-compatible:groq:qwen/qwen3.8-27b", suite: "smoke", smallModel: true })).toBe(
      "2026-10-16-openai-compatible_groq_qwen_qwen3.8-27b-small-smoke",
    );
    expect(evalSlug("2026-10-20", { model: "configured", label: LABEL, suite: "full" })).toBe(
      "2026-10-20-vllm-kaggle-2-t4-qwen3.8-27b-awq-full",
    );
  });
});

describe("selectDatasets", () => {
  // Ids only: generating the 30 businesses takes seconds, and selection never reads their files.
  const ids = ["coffee_roaster-v1", "saas-v2", "restaurant-v3", "agency-v1"];
  const all = ids.map((id) => ({ id })) as unknown as Dataset[];
  it("returns the whole suite, or only the named datasets in suite order", () => {
    expect(selectDatasets("full", undefined, all).map((d) => d.id)).toEqual(ids);
    expect(selectDatasets("full", ["agency-v1", "saas-v2"], all).map((d) => d.id)).toEqual(["saas-v2", "agency-v1"]);
  });
  it("refuses an id that is not in the suite", () => {
    expect(() => selectDatasets("full", ["saas-v9"], all)).toThrow(EvalRunError);
    expect(() => selectDatasets("smoke", ["agency-v1"], all)).toThrow(/not in the smoke suite: agency-v1/);
  });
});

describe("mergeResults", () => {
  const score = (dataset: string, completed: boolean, seconds: number) =>
    ({
      dataset,
      completed,
      planted: [],
      distractorsReported: [],
      qualityFound: [],
      distractors: 0,
      quality: 0,
      findings: 0,
      seconds,
      tokens: { input: 100, output: 10 },
      routes: [{ role: "planner", route: "openai-compatible:vllm:Qwen3.8-27B-AWQ", calls: 3, cached: 0, failed: 0 }],
    }) as unknown as SuiteResult["scores"][number];
  const part = (date: string, ...scores: SuiteResult["scores"]): SuiteResult => ({
    suite: "full",
    model: "configured",
    date,
    datasets: scores.length,
    scores,
    bars: [],
    seconds: 1,
    tokens: { input: 0, output: 0 },
  });
  const order = ["a-v1", "b-v1", "c-v1"];

  it("joins one-business runs into one result in suite order, with their real timings and the bars recomputed", () => {
    const m = mergeResults(
      [part("2026-10-21", score("c-v1", true, 600)), part("2026-10-20", score("a-v1", true, 500), score("b-v1", false, 40))],
      {
        suite: "full",
        modelName: LABEL,
        note: "n",
        order,
      },
    );
    expect(m.scores.map((s) => s.dataset)).toEqual(order);
    expect(m).toMatchObject({
      model: LABEL,
      note: "n",
      date: "2026-10-21",
      datasets: 3,
      seconds: 1140,
      tokens: { input: 300, output: 30 },
    });
    expect(m.bars.find((b) => b.metric === "Jobs completed")?.value).toBeCloseTo(2 / 3);
    expect(m.routes).toEqual([{ role: "planner", route: "openai-compatible:vllm:Qwen3.8-27B-AWQ", calls: 9, cached: 0, failed: 0 }]);
  });

  it("refuses a missing, repeated or foreign dataset, and runs of different models", () => {
    const o = { suite: "full" as const, modelName: LABEL, order };
    expect(() => mergeResults([part("d", score("a-v1", true, 1))], o)).toThrow(/missing from the runs: b-v1, c-v1/);
    expect(() =>
      mergeResults(
        [part("d", score("a-v1", true, 1), score("b-v1", true, 1)), part("d", score("b-v1", true, 1), score("c-v1", true, 1))],
        o,
      ),
    ).toThrow(/b-v1 is in more than one run/);
    expect(() =>
      mergeResults([part("d", score("a-v1", true, 1), score("b-v1", true, 1), score("c-v1", true, 1), score("z-v1", true, 1))], o),
    ).toThrow(/not in the full suite: z-v1/);
    expect(() =>
      mergeResults(
        [part("d", score("a-v1", true, 1)), { ...part("d", score("b-v1", true, 1), score("c-v1", true, 1)), model: "other" }],
        o,
      ),
    ).toThrow(/different models/);
  });
});

describe("evalCommand with --label, --note and --only", () => {
  it("writes the run under its label, as its own RESULTS.md section, in the same results schema", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-eval-label-"));
    const results = join(dir, "results");
    const page = join(dir, "RESULTS.md");
    // An earlier `configured` run already published: the labelled run must not replace it.
    const r = await evalCommand(
      {
        suite: "full",
        model: "baseline",
        label: LABEL,
        note: "Kaggle notebook, 2×T4.",
        only: ["coffee_roaster-v1"],
        resultsDir: results,
        resultsPage: page,
      },
      { embedder: hashEmbedder(), print: () => {}, now: () => new Date("2026-10-20T10:00:00Z") },
    );
    writeFileSync(
      join(results, "2026-10-17-configured-small-full.json"),
      JSON.stringify({ ...r, model: "configured (small-model mode)", note: "" }),
    );
    expect(readdirSync(results)).toContain("2026-10-20-vllm-kaggle-2-t4-qwen3.8-27b-awq-full.json");
    const written = JSON.parse(readFileSync(join(results, "2026-10-20-vllm-kaggle-2-t4-qwen3.8-27b-awq-full.json"), "utf8")) as SuiteResult;
    expect(written.model).toBe(LABEL);
    expect(written.note).toBe("Kaggle notebook, 2×T4.");
    expect(written.datasets).toBe(1);
    expect(written.scores.map((s) => s.dataset)).toEqual(["coffee_roaster-v1"]);
    // Same keys as any other run (SuiteResult): nothing notebook-specific is added.
    expect(Object.keys(written).sort()).toEqual([
      "bars",
      "datasets",
      "date",
      "model",
      "note",
      "routes",
      "scores",
      "seconds",
      "suite",
      "tokens",
    ]);
    const md = resultsPage(results);
    expect(md).toContain(`### ${LABEL} · full suite · 2026-10-20`);
    expect(md).toContain("### configured (small-model mode) · full suite");
  }, 120_000);
});
