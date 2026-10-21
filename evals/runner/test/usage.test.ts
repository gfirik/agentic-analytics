// A run's provider usage (M14a): tokens per route from the call records, cached calls at 0, summed into the
// suite result's `usage` and shown in RESULTS.md; results written before M14a read "n/a". Expected values by hand.
import type { CallRecord } from "@agentic-analytics/models";
import { describe, expect, it } from "vitest";
import { mergeResults, mergeRoutes, resultsMarkdown, routeSummary, runUsage, type SuiteResult, usageLine } from "../src/index.ts";

const call = (c: Partial<CallRecord>): CallRecord => ({
  role: "planner",
  provider: "openai-compatible",
  endpoint: "groq",
  model: "qwen/qwen3.8-27b",
  status: 200,
  cached: false,
  ms: 1,
  ...c,
});

describe("run usage", () => {
  it("routeSummary sums each route's tokens: cached calls 0, a call with no count is counted as unknown", () => {
    const routes = routeSummary([
      call({ inputTokens: 9000, outputTokens: 600 }),
      // cached: the stored usage is ignored
      call({ cached: true, inputTokens: 9000, outputTokens: 600 }),
      call({ status: 429 }),
      // no response at all: failed, as aa usage counts it
      call({ role: "judge", status: 0 }),
      call({ role: "extractor", model: "openai/gpt-oss-120b", inputTokens: 400, outputTokens: 100 }),
    ]);
    expect(routes.find((u) => u.role === "judge")).toMatchObject({ calls: 1, failed: 1, unknownTokens: 1 });
    expect(routes.filter((u) => u.role !== "judge")).toEqual([
      {
        role: "extractor",
        route: "openai-compatible:groq:openai/gpt-oss-120b",
        calls: 1,
        cached: 0,
        failed: 0,
        inputTokens: 400,
        outputTokens: 100,
        unknownTokens: 0,
      },
      {
        role: "planner",
        route: "openai-compatible:groq:qwen/qwen3.8-27b",
        calls: 3,
        cached: 1,
        failed: 1,
        inputTokens: 9000,
        outputTokens: 600,
        unknownTokens: 1,
      },
    ]);
    // 9,000 + 400 in; 600 + 100 out; 4 calls, 1 cached, 1 (the 429) without a count
    expect(runUsage(routes.filter((u) => u.role !== "judge"))).toEqual({
      inputTokens: 9400,
      outputTokens: 700,
      calls: 4,
      cached: 1,
      unknownTokens: 1,
    });
  });

  it("a route from before M14a has no token count: merged usage is unknown, not 0", () => {
    const old = { role: "planner", route: "r", calls: 2, cached: 0, failed: 0 };
    const fresh = { ...old, calls: 1, inputTokens: 10, outputTokens: 1 };
    expect(mergeRoutes([fresh, fresh])).toEqual([{ ...old, calls: 2, inputTokens: 20, outputTokens: 2 }]);
    expect(mergeRoutes([fresh, old])).toEqual([{ ...old, calls: 3 }]);
    expect(runUsage(mergeRoutes([fresh, old]))).toBeUndefined();
    expect(runUsage([])).toEqual({ inputTokens: 0, outputTokens: 0, calls: 0, cached: 0, unknownTokens: 0 });
  });

  it("RESULTS.md shows the totals, or n/a for an old result", () => {
    expect(usageLine({ inputTokens: 168179, outputTokens: 20673, calls: 131, cached: 47, unknownTokens: 31 })).toBe(
      "Usage: 168,179 tokens in, 20,673 out · 131 calls (47 cached at 0 tokens, 31 without a token count)",
    );
    expect(usageLine({ inputTokens: 10, outputTokens: 1, calls: 2, cached: 0, unknownTokens: 0 })).toBe(
      "Usage: 10 tokens in, 1 out · 2 calls (0 cached at 0 tokens)",
    );
    // The scripted baseline makes no provider calls.
    expect(usageLine({ inputTokens: 0, outputTokens: 0, calls: 0, cached: 0, unknownTokens: 0 })).toBe(
      "Usage: no provider calls (scripted model)",
    );
    expect(usageLine(undefined)).toBe("Usage: n/a (tokens per call not recorded for this run)");
  });

  it("mergeResults records usage from the parts' routes", () => {
    const part = (dataset: string, inputTokens: number): SuiteResult => {
      const routes = [{ role: "planner", route: "r", calls: 1, cached: 0, failed: 0, inputTokens, outputTokens: 1 }];
      return {
        suite: "smoke",
        model: "m",
        date: "2026-10-20",
        datasets: 1,
        scores: [
          {
            dataset,
            completed: true,
            planted: [],
            distractorsReported: [],
            qualityFound: [],
            quality: 0,
            findings: 0,
            seconds: 1,
            tokens: { input: 0, output: 0 },
            routes,
          } as unknown as SuiteResult["scores"][number],
        ],
        bars: [],
        seconds: 1,
        tokens: { input: 0, output: 0 },
        routes,
      };
    };
    const merged = mergeResults([part("a", 5), part("b", 7)], { suite: "smoke", modelName: "m", order: ["a", "b"] });
    expect(merged.usage).toEqual({ inputTokens: 12, outputTokens: 2, calls: 2, cached: 0, unknownTokens: 0 });
    expect(resultsMarkdown(merged)).toContain("Usage: 12 tokens in, 2 out · 2 calls (0 cached at 0 tokens)");
  });
});
