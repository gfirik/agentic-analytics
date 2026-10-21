// Token usage from the call log (models §5, token usage). Expected values are summed by hand from the lines below.
import { describe, expect, it } from "vitest";
import { dailyTokenLimit, dailyUsage, dayOf, ModelError, parseCallLog, resolveModelConfig, spendOf, sumCalls } from "../src/index.ts";

const qwen = `"provider":"openai-compatible","endpoint":"groq","model":"qwen/qwen3.8-27b"`;
const LOG = [
  // planner, live: 1000 in, 100 out
  `{"at":"2026-10-19T22:00:00.000Z","role":"planner",${qwen},"status":200,"cached":false,"ms":300,"inputTokens":1000,"outputTokens":100}`,
  // planner, cached, written before M14a with the cached answer's usage: counts 0
  `{"at":"2026-10-19T22:01:00.000Z","role":"planner",${qwen},"status":200,"cached":true,"ms":0,"inputTokens":462,"outputTokens":120}`,
  // planner, rate-limited, no usage: unknown and failed
  `{"at":"2026-10-19T22:02:00.000Z","role":"planner",${qwen},"status":429,"cached":false,"ms":40,"error":"Rate limit reached"}`,
  // extractor, live, last millisecond of the UTC day: 300 in, 50 out
  `{"at":"2026-10-19T23:59:59.999Z","role":"extractor","provider":"openai-compatible","endpoint":"groq","model":"openai/gpt-oss-120b","status":200,"cached":false,"ms":900,"inputTokens":300,"outputTokens":50}`,
  // judge on a local Ollama, the next UTC day: 20 in, 5 out
  `{"at":"2026-10-20T00:00:00.000Z","role":"judge","provider":"ollama","model":"qwen3.5:9b","status":200,"cached":false,"ms":2000,"inputTokens":20,"outputTokens":5}`,
  "{",
  `{"foo":1}`,
  "",
].join("\n");

const config = resolveModelConfig({});
const limitOf = (r: Parameters<typeof dailyTokenLimit>[1]) => dailyTokenLimit(config, r);

describe("token usage", () => {
  it("a cached call spends 0; a call without a count is unknown, not 0", () => {
    expect(spendOf({ cached: true, inputTokens: 462, outputTokens: 120 })).toEqual({ input: 0, output: 0 });
    expect(spendOf({ cached: false, inputTokens: 10, outputTokens: 2 })).toEqual({ input: 10, output: 2 });
    expect(spendOf({ cached: false })).toBeUndefined();
  });

  it("parses the log and counts the lines that aren't call records", () => {
    const log = parseCallLog(LOG);
    expect(log.calls).toHaveLength(5);
    expect(log.skipped).toBe(2);
    expect(log.calls[2]?.inputTokens).toBeUndefined();
  });

  it("sums per UTC day, newest first, with per-role and per-route totals", () => {
    const days = dailyUsage(parseCallLog(LOG).calls, { limitOf });
    expect(days.map((d) => d.day)).toEqual(["2026-10-20", "2026-10-19"]);
    const d19 = days[1];
    expect(d19?.totals).toEqual({ calls: 4, cached: 1, failed: 1, inputTokens: 1300, outputTokens: 150, unknownTokens: 1 });
    expect(d19?.roles).toEqual([
      { role: "extractor", totals: { calls: 1, cached: 0, failed: 0, inputTokens: 300, outputTokens: 50, unknownTokens: 0 } },
      { role: "planner", totals: { calls: 3, cached: 1, failed: 1, inputTokens: 1000, outputTokens: 100, unknownTokens: 1 } },
    ]);
    expect(d19?.routes).toEqual([
      {
        route: "openai-compatible:groq:openai/gpt-oss-120b",
        totals: { calls: 1, cached: 0, failed: 0, inputTokens: 300, outputTokens: 50, unknownTokens: 0 },
      },
      {
        route: "openai-compatible:groq:qwen/qwen3.8-27b",
        totals: { calls: 3, cached: 1, failed: 1, inputTokens: 1000, outputTokens: 100, unknownTokens: 1 },
        dailyLimit: 200_000,
      },
    ]);
    expect(days[0]?.routes).toEqual([
      { route: "ollama:qwen3.5:9b", totals: { calls: 1, cached: 0, failed: 0, inputTokens: 20, outputTokens: 5, unknownTokens: 0 } },
    ]);
  });

  it("keeps one day with --day, and refuses a day that isn't YYYY-MM-DD", () => {
    const calls = parseCallLog(LOG).calls;
    expect(dailyUsage(calls, { day: "2026-10-20" }).map((d) => d.totals.inputTokens)).toEqual([20]);
    expect(dailyUsage(calls, { day: "2026-10-18" })).toEqual([]);
    expect(() => dailyUsage(calls, { day: "19.10.2026" })).toThrow(ModelError);
  });

  it("days are UTC dates, whatever offset the timestamp carries", () => {
    expect(dayOf("2026-10-20T01:30:00+03:00")).toBe("2026-10-19");
  });

  it("the daily limit comes from the route config: Groq's preset, a config file's own, none for Ollama", () => {
    expect(limitOf({ provider: "openai-compatible", endpoint: "groq", model: "qwen/qwen3.8-27b" })).toBe(200_000);
    expect(limitOf({ provider: "openai-compatible", endpoint: "groq", model: "openai/gpt-oss-20b" })).toBeUndefined();
    expect(limitOf({ provider: "ollama", model: "qwen3.5:9b" })).toBeUndefined();
    const custom = resolveModelConfig(
      {},
      {
        providers: {
          "openai-compatible": { local: { base_url: "http://localhost:8000/v1", daily_token_limits: { "my-model": 50_000 } } },
        },
      },
    );
    expect(dailyTokenLimit(custom, { provider: "openai-compatible", endpoint: "local", model: "my-model" })).toBe(50_000);
    // A file entry for groq keeps the preset's limits under its own (the file wins per model).
    const groq = resolveModelConfig(
      {},
      {
        providers: {
          "openai-compatible": {
            groq: {
              base_url: "https://api.groq.com/openai/v1",
              structured_outputs: true,
              daily_token_limits: { "openai/gpt-oss-20b": 1_000 },
            },
          },
        },
      },
    );
    expect(groq.providers["openai-compatible"]?.groq?.structured_outputs).toBe(true);
    expect(groq.providers["openai-compatible"]?.groq?.daily_token_limits).toEqual({
      "qwen/qwen3.8-27b": 200_000,
      "openai/gpt-oss-20b": 1_000,
    });
  });

  it("sumCalls totals a run's calls the same way", () => {
    expect(sumCalls(parseCallLog(LOG).calls)).toEqual({
      calls: 5,
      cached: 1,
      failed: 1,
      inputTokens: 1320,
      outputTokens: 155,
      unknownTokens: 1,
    });
  });
});
