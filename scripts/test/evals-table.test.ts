// The README's results table labels a run whose jobs didn't all finish as partial (M13a: the full Groq suite ran
// 3 of 30 jobs before the free tier's daily quota stopped it), so its rates are never read as the model's quality.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evalsTable } from "../readme-assets/assets.ts";

const result = (suite: string, datasets: number, completed: number) => ({
  suite,
  model: "openai-compatible:groq:qwen/qwen3.8-27b (small-model mode)",
  datasets,
  seconds: 120,
  tokens: { input: 1000, output: 500 },
  bars: [{ metric: "Jobs completed", value: completed }],
});

describe("evalsTable", () => {
  it("labels a run with unfinished jobs as partial and counts the finished ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-evals-table-"));
    writeFileSync(join(dir, "a-full.json"), JSON.stringify(result("full", 30, 0.1)));
    writeFileSync(join(dir, "b-smoke.json"), JSON.stringify(result("smoke", 3, 1)));
    const rows = evalsTable(dir).split("\n").slice(2);
    // 0.1 × 30 = 3 finished jobs.
    expect(rows[0]).toContain("| full (30), **partial: 3 of 30 jobs finished** |");
    expect(rows[1]).toContain("| smoke (3) |");
    expect(rows[1]).not.toContain("partial");
  });

  it("shows a labelled self-hosted vLLM run (aa eval --label) as its own row, with the hardware from its label", () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-evals-table-"));
    writeFileSync(join(dir, "2026-10-17-configured-small-full.json"), JSON.stringify(result("full", 30, 0.1)));
    writeFileSync(
      join(dir, "2026-10-20-vllm-kaggle-2-t4-qwen3.8-27b-awq-full.json"),
      JSON.stringify({ ...result("full", 30, 1), model: "vllm (Kaggle 2×T4) Qwen3.8-27B-AWQ", date: "2026-10-20" }),
    );
    const rows = evalsTable(dir).split("\n").slice(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("| groq:qwen/qwen3.8-27b (small-model mode) |");
    expect(rows[0]).toContain("| Groq free tier (hosted) |");
    expect(rows[1]).toMatch(/^\| vllm \(Kaggle 2×T4\) Qwen3\.8-27B-AWQ \| full \(30\) \| 100% \|/);
    expect(rows[1]).toContain("| Kaggle 2×T4 (self-hosted vLLM) | 2026-10-20 |");
  });
});
