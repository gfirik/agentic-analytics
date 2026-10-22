// `aa eval --no-cache` (implied by --repeat, docs/specs/accuracy.md §7): with the cache off, no call reads or writes
// it, so runs 2..N can't replay run 1. The real client runs against a stubbed transport, never a network model.
import { type CallRecord, memoryCache, type ResponseCache, Router, resolveModelConfig } from "@agentic-analytics/models";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { repeatArgs } from "../src/eval-args.ts";
import { evalModelFor } from "../src/eval-models.ts";

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

/** Answers every chat-completions request with the same object, counting the requests that reached it. */
function stub(sent: { n: number }): typeof fetch {
  return (async () => {
    sent.n++;
    return Response.json({
      id: "cmpl-1",
      object: "chat.completion",
      created: 0,
      model: "stub",
      choices: [{ index: 0, message: { role: "assistant", content: '{"reply":"OK"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
    });
  }) as typeof fetch;
}

/** The same request once per run, each run with a fresh client as evalRepeat builds one per dataset per run. */
async function repeatRuns(cacheOff: boolean, runs: number) {
  const sent = { n: 0 };
  const cache = memoryCache();
  let built = 0;
  const records: CallRecord[] = [];
  const modelFor = evalModelFor({
    env: { OLLAMA_BASE_URL: "http://ollama.test:11434" },
    config: (env) => resolveModelConfig(env),
    router: new Router(),
    cache: (): ResponseCache => {
      built++;
      return cache;
    },
    cacheOff,
    log: () => {},
    fetch: stub(sent),
  });
  for (let k = 0; k < runs; k++) {
    const client = modelFor("ollama:qwen3.5:9b", (c) => records.push(c));
    await client.generateObject({ role: "planner", schema: z.object({ reply: z.string() }), system: "s", prompt: "the same prompt" });
  }
  return { records, sent: sent.n, stored: cache.size, built };
}

describe("evalModelFor and the response cache", () => {
  it("with the cache off, every call of every repeat is live: cached false, nothing read or written", async () => {
    const r = await repeatRuns(repeatArgs({ repeat: "3" }).cacheOff, 3);
    expect(r.records.map((c) => c.cached)).toEqual([false, false, false]);
    expect(r.sent).toBe(3);
    expect(r.stored).toBe(0);
    expect(r.built).toBe(0);
  });

  it("with the cache on (the default), runs 2..N replay run 1: the reason --repeat turns it off", async () => {
    const r = await repeatRuns(repeatArgs({}).cacheOff, 3);
    expect(r.records.map((c) => c.cached)).toEqual([false, true, true]);
    expect(r.sent).toBe(1);
    expect(r.stored).toBe(1);
  });
});

describe("repeatArgs", () => {
  it("turns the cache off for --no-cache and for --repeat, and leaves it on otherwise", () => {
    expect(repeatArgs({})).toEqual({ cacheOff: false });
    expect(repeatArgs({ noCache: true })).toEqual({ cacheOff: true });
    expect(repeatArgs({ repeat: "5", suite: "full" })).toEqual({ repeat: 5, cacheOff: true });
  });
  it("refuses a count below 2 or not whole, --suite real and --passes", () => {
    for (const bad of ["1", "0", "2.5", "five", "", "-3", "0x2", "1e1", "2.0", " 3"])
      expect(() => repeatArgs({ repeat: bad })).toThrow(/whole number ≥ 2/);
    expect(() => repeatArgs({ repeat: "3", suite: "real" })).toThrow(/smoke, full or heldout, not real/);
    expect(() => repeatArgs({ repeat: "3", passes: "2" })).toThrow(/drop --passes/);
  });
});
