// The README's results table labels a run whose jobs didn't all finish as partial (M13a: the full Groq suite ran
// 3 of 30 jobs before the free tier's daily quota stopped it), so its rates are never read as the model's quality.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evalsTable, hostOf, statusBlock } from "../readme-assets/assets.ts";

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

describe("statusBlock", () => {
  it("leads with the real data and the smoke run, and links the full suite as the nightly regression check", () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-status-"));
    const check = (pass: boolean) => ({ id: "c", about: "a", pass });
    writeFileSync(
      join(dir, "2026-10-17-baseline-real.json"),
      JSON.stringify({
        suite: "real",
        model: "baseline",
        date: "2026-10-17",
        datasets: [{ checks: [check(true), check(true)] }, { checks: [check(false)] }],
      }),
    );
    const smoke = {
      ...result("smoke", 3, 1),
      bars: [
        { metric: "Jobs completed", value: 1 },
        { metric: "Number mismatches", value: 0 },
        { metric: "Citation precision", value: 1 },
      ],
    };
    writeFileSync(join(dir, "2026-10-16-configured-small-smoke.json"), JSON.stringify(smoke));
    writeFileSync(join(dir, "2026-10-17-configured-small-full.json"), JSON.stringify(result("full", 30, 0.1)));
    const text = statusBlock(dir);
    const lines = text.split("\n");
    expect(lines[2]).toContain("2 of 3 checks pass on 2 public datasets");
    expect(lines[3]).toContain(
      "qwen/qwen3.8-27b (Groq free tier) finished 3 of 3 smoke jobs with 0 wrong numbers and 100% citation precision",
    );
    expect(lines.at(-1)).toContain("30 generated businesses with planted events are the nightly regression check");
    // The full suite's partial pass is linked, never headlined.
    expect(text).not.toMatch(/partial|3 of 30|in progress/);
  });
});

describe("hostOf", () => {
  it("names where a run's model ran: a vLLM label's hardware, Groq, local Ollama, or hosted", () => {
    expect(hostOf("vllm (Kaggle 2×T4) Qwen3.8-27B-AWQ")).toBe("Kaggle 2×T4 (self-hosted vLLM)");
    expect(hostOf("openai-compatible:groq:qwen/qwen3.8-27b")).toBe("Groq free tier (hosted)");
    expect(hostOf("ollama:qwen3.5:9b")).toBe("local (see note)");
    expect(hostOf("openai-compatible:openrouter:openai/gpt-oss-120b")).toBe("hosted");
  });
});
