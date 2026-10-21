// `aa usage` on a small call log. The totals are summed by hand from the lines below.
import { dailyTokenLimit, resolveModelConfig } from "@agentic-analytics/models";
import { describe, expect, it } from "vitest";
import { UsageError, usageCommand, usageReport } from "../src/usage.ts";

const groq = (model: string) => `"provider":"openai-compatible","endpoint":"groq","model":"${model}"`;
const LOG = [
  // planner: 9,000 + 600 live, a cached call (0), a 429 with no count
  `{"at":"2026-10-19T22:00:00.000Z","role":"planner",${groq("qwen/qwen3.8-27b")},"status":200,"cached":false,"ms":300,"inputTokens":9000,"outputTokens":600}`,
  `{"at":"2026-10-19T22:01:00.000Z","role":"planner",${groq("qwen/qwen3.8-27b")},"status":200,"cached":true,"ms":0,"inputTokens":9000,"outputTokens":600}`,
  `{"at":"2026-10-19T22:02:00.000Z","role":"planner",${groq("qwen/qwen3.8-27b")},"status":429,"cached":false,"ms":40}`,
  // extractor: 400 + 100
  `{"at":"2026-10-19T22:03:00.000Z","role":"extractor",${groq("openai/gpt-oss-120b")},"status":200,"cached":false,"ms":800,"inputTokens":400,"outputTokens":100}`,
  // the day before: judge 50 + 10
  `{"at":"2026-10-18T10:00:00.000Z","role":"judge",${groq("openai/gpt-oss-20b")},"status":200,"cached":false,"ms":500,"inputTokens":50,"outputTokens":10}`,
  "not json",
].join("\n");

const config = resolveModelConfig({});
const limitOf = (r: Parameters<typeof dailyTokenLimit>[1]) => dailyTokenLimit(config, r);

describe("aa usage", () => {
  it("prints each UTC day newest first, per role and per route, with the known daily limit", () => {
    expect(usageReport(LOG, { limitOf })).toBe(
      [
        "2026-10-19 (UTC): 4 calls (1 cached, 1 failed, 1 without a token count); 9,400 tokens in, 700 out",
        "  Per role:",
        "    extractor  1 call   400 in    100 out",
        "    planner    3 calls  9,000 in  600 out  (1 cached, 1 failed, 1 without a token count)",
        "  Per route (a daily limit counts input + output tokens):",
        "    openai-compatible:groq:openai/gpt-oss-120b  1 call   500 tokens    no known limit",
        // 9,600 of 200,000 = 4.8%
        "    openai-compatible:groq:qwen/qwen3.8-27b     3 calls  9,600 tokens  of 200,000 a day (4.8%)",
        "",
        "2026-10-18 (UTC): 1 call; 50 tokens in, 10 out",
        "  Per role:",
        "    judge  1 call  50 in  10 out",
        "  Per route (a daily limit counts input + output tokens):",
        "    openai-compatible:groq:openai/gpt-oss-20b  1 call  60 tokens  no known limit",
        "",
        "1 line of the log is not a call record and was skipped.",
        "",
        "Cached calls count 0 tokens (they spend no quota). Days are UTC dates.",
        "",
      ].join("\n"),
    );
  });

  it("--day keeps one day; a day with no calls says so", () => {
    expect(usageReport(LOG, { day: "2026-10-18", limitOf }).split("\n")[0]).toBe("2026-10-18 (UTC): 1 call; 50 tokens in, 10 out");
    expect(usageReport(LOG, { day: "2026-10-17" }).split("\n")[0]).toBe("No model calls on 2026-10-17 (UTC).");
  });

  it("--json gives the same numbers", () => {
    const j = JSON.parse(usageReport(LOG, { json: true, day: "2026-10-19", limitOf })) as {
      days: { day: string; routes: { route: string; dailyLimit?: number }[] }[];
      skippedLines: number;
    };
    expect(j.skippedLines).toBe(1);
    expect(j.days.map((d) => d.day)).toEqual(["2026-10-19"]);
    expect(j.days[0]?.routes.map((r) => r.dailyLimit)).toEqual([undefined, 200_000]);
  });

  it("an empty --day is refused, not read as every day", () => {
    expect(() => usageReport(LOG, { day: "" })).toThrow(/invalid day/);
  });

  it("a missing log is a typed error", () => {
    expect(() => usageCommand("/nonexistent/model-calls.jsonl")).toThrow(UsageError);
  });
});
