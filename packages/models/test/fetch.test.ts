// The provider HTTP layer: reasoning is not sent back, and a 429 waits as long as the endpoint asks (Groq's free
// tier: "Please try again in 24.735s"), within a cap. No network: a scripted fetch.
import { describe, expect, it } from "vitest";
import { type CallRecord, memoryCache, otpmRefusalLimit, outputLimit, providerFetch, type RouteLease, retryAfterMs } from "../src/index.ts";

const limited = (body: string, headers: Record<string, string> = {}) => new Response(body, { status: 429, headers });

describe("providerFetch", () => {
  it("reads the wait from Retry-After or from the message", () => {
    expect(retryAfterMs(new Headers({ "retry-after": "7" }), "")).toBe(7000);
    expect(retryAfterMs(new Headers(), "Please try again in 24.735s. Need more tokens?")).toBeCloseTo(24735, 6);
    expect(retryAfterMs(new Headers(), "try again in 1m2.5s")).toBe(62500);
    expect(retryAfterMs(new Headers(), "try again in 640ms")).toBe(640);
    expect(retryAfterMs(new Headers(), "slow down")).toBeUndefined();
  });

  it("retries a 429 after the requested wait, and gives up past the cap", async () => {
    const waits: number[] = [];
    const calls: string[] = [];
    let n = 0;
    const base = (async (_u: unknown, init?: RequestInit) => {
      calls.push(String(init?.body));
      return n++ < 2 ? limited("Rate limit reached. Please try again in 1.5s.") : new Response("{}", { status: 200 });
    }) as typeof fetch;
    const f = providerFetch(base, { sleep: async (ms) => void waits.push(ms) });
    expect((await f("https://x/v1/chat/completions", { method: "POST", body: "{}" })).status).toBe(200);
    expect(waits).toEqual([1750, 1750]);
    const tooLong = providerFetch((async () => limited("try again in 10m0s")) as typeof fetch, {
      sleep: async (ms) => void waits.push(ms),
    });
    expect((await tooLong("https://x", {})).status).toBe(429);
    expect(waits).toHaveLength(2);
  });

  it("drops reasoning_content from the messages it sends", async () => {
    let sent = "";
    const f = providerFetch((async (_u: unknown, init?: RequestInit) => {
      sent = String(init?.body);
      return new Response("{}");
    }) as typeof fetch);
    const body = {
      model: "m",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "", reasoning_content: "thinking", tool_calls: [] },
      ],
    };
    await f("https://x", { method: "POST", body: JSON.stringify(body) });
    expect(JSON.parse(sent).messages[1]).toEqual({ role: "assistant", content: "", tool_calls: [] });
  });

  it("retries a 413 output-tokens-per-minute refusal once, with max_tokens under the limit", async () => {
    const bodies: string[] = [];
    let n = 0;
    const f = providerFetch((async (_u: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return n++ === 0
        ? new Response("Request too large for model `qwen/qwen3.8-27b` … on output tokens per minute (OTPM): Limit 1000, Requested 1047.", {
            status: 413,
          })
        : new Response("{}");
    }) as typeof fetch);
    expect((await f("https://x", { method: "POST", body: JSON.stringify({ model: "m", messages: [] }) })).status).toBe(200);
    expect(JSON.parse(bodies[1] ?? "{}").max_tokens).toBe(950);
    expect(outputLimit("tokens per minute (TPM): Limit 8000")).toBeUndefined();
  });
  // Groq sometimes sends the OTPM refusal as a 429 (2026-10-17 20:52:58Z planner call): it is not a rate limit to wait
  // out or to hand to the router, since the same request would be refused again.
  const otpm429 = () =>
    limited(
      "Request too large for model `qwen/qwen3.8-27b` in organization `org_01jq3x5v8k2m4n6p7r9s0t1w2y` … on output tokens per minute (OTPM): Limit 1000, Requested 1530. Please try again in 31.2s.",
      { "retry-after": "32" },
    );
  // A real OTPM rate limit: this request fits the limit once the minute's earlier output has aged out.
  const otpmRateLimit = () =>
    limited(
      "Rate limit reached for model `qwen/qwen3.8-27b` on output tokens per minute (OTPM): Limit 1000, Used 800, Requested 300. Please try again in 6s.",
    );
  const leaseSpy = (calls: string[]): RouteLease => ({
    route: { provider: "openai-compatible", endpoint: "groq", model: "qwen/qwen3.8-27b" } as RouteLease["route"],
    cacheOnly: () => false,
    limitedFor: () => 0,
    maxWait: () => 90_000,
    pause: async () => void calls.push("pause"),
    observe: () => void calls.push("observe"),
    // Another route is free: a rate-limit 429 would be handed back to the router (RouteBusyError).
    shouldYield: () => {
      calls.push("shouldYield");
      return true;
    },
    started: () => void calls.push("started"),
  });
  const post = (body: Record<string, unknown> = { model: "m" }) => ({ method: "POST", body: JSON.stringify(body) });

  it("tells an OTPM refusal from an OTPM rate limit", () => {
    expect(otpmRefusalLimit(413, "output tokens per minute (OTPM): Limit 1000, Requested 1047")).toBe(1000);
    expect(otpmRefusalLimit(429, "Request too large … output tokens per minute (OTPM): Limit 1000, Requested 1530")).toBe(1000);
    expect(otpmRefusalLimit(429, "Rate limit reached … output tokens per minute (OTPM): Limit 1000, Requested 1530")).toBe(1000);
    expect(
      otpmRefusalLimit(429, "Rate limit reached … output tokens per minute (OTPM): Limit 1000, Used 800, Requested 300"),
    ).toBeUndefined();
    expect(otpmRefusalLimit(429, "Rate limit reached … output tokens per minute (OTPM): Limit 1000")).toBeUndefined();
    expect(otpmRefusalLimit(400, "Request too large … output tokens per minute (OTPM): Limit 1000")).toBeUndefined();
  });

  it("retries a 429 OTPM refusal once, at once, with max_tokens under the limit; no wait, no hand-off; the refusal is logged", async () => {
    const bodies: string[] = [];
    const waits: number[] = [];
    const leaseCalls: string[] = [];
    const calls: CallRecord[] = [];
    let n = 0;
    const f = providerFetch(
      (async (_u: unknown, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return n++ === 0 ? otpm429() : new Response("{}");
      }) as typeof fetch,
      { sleep: async (ms) => void waits.push(ms), lease: leaseSpy(leaseCalls), onCall: (c) => calls.push(c) },
    );
    const res = await f("https://x", post({ model: "m", messages: [], max_tokens: 4096 }));
    expect(res.status).toBe(200);
    expect(bodies).toHaveLength(2);
    expect(JSON.parse(bodies[1] ?? "{}").max_tokens).toBe(950);
    expect(waits).toEqual([]);
    expect(leaseCalls).toEqual(["observe", "observe", "started"]);
    expect(calls.map((c) => c.status)).toEqual([429, 200]);
    expect(calls[0]?.error).toContain("org_***");
    expect(calls[0]?.error).not.toContain("org_01jq3x5v8k2m4n6p7r9s0t1w2y");
  });

  it("records the provider's token usage on a live call and 0 on a cached one (it spends no quota)", async () => {
    const calls: CallRecord[] = [];
    const body = JSON.stringify({ choices: [{ finish_reason: "stop" }], usage: { prompt_tokens: 462, completion_tokens: 120 } });
    const f = providerFetch((async () => new Response(body)) as typeof fetch, { cache: memoryCache(), onCall: (c) => calls.push(c) });
    await f("https://x", post());
    await f("https://x", post());
    expect(calls.map((c) => [c.cached, c.inputTokens, c.outputTokens])).toEqual([
      [false, 462, 120],
      [true, 0, 0],
    ]);
  });

  it("logs a 413 OTPM refusal as a failed call before the re-send", async () => {
    const calls: CallRecord[] = [];
    let n = 0;
    const f = providerFetch(
      (async () =>
        n++ === 0
          ? new Response("output tokens per minute (OTPM): Limit 1000, Requested 1047", { status: 413 })
          : new Response("{}")) as typeof fetch,
      { onCall: (c) => calls.push(c) },
    );
    expect((await f("https://x", post())).status).toBe(200);
    expect(calls.map((c) => c.status)).toEqual([413, 200]);
  });

  it("a second 413 refusal, after max_tokens was lowered, is returned as it is: no wait, no third request", async () => {
    const waits: number[] = [];
    let n = 0;
    const f = providerFetch(
      (async () => {
        n++;
        return new Response("output tokens per minute (OTPM): Limit 1000, Requested 1047", { status: 413 });
      }) as typeof fetch,
      { sleep: async (ms) => void waits.push(ms) },
    );
    expect((await f("https://x", post())).status).toBe(413);
    expect(n).toBe(2);
    expect(waits).toEqual([]);
  });

  it("an OTPM 429 rate limit (Used + Requested within the limit) waits, or hands off, like any 429", async () => {
    const bodies: string[] = [];
    const waits: number[] = [];
    let n = 0;
    const f = providerFetch(
      (async (_u: unknown, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return n++ === 0 ? otpmRateLimit() : new Response("{}");
      }) as typeof fetch,
      { sleep: async (ms) => void waits.push(ms) },
    );
    expect((await f("https://x", post())).status).toBe(200);
    expect(waits).toEqual([6_250]);
    expect(bodies.map((b) => JSON.parse(b).max_tokens)).toEqual([undefined, undefined]);
    const leaseCalls: string[] = [];
    const routed = providerFetch((async () => otpmRateLimit()) as typeof fetch, { sleep: async () => {}, lease: leaseSpy(leaseCalls) });
    await expect(routed("https://x", post())).rejects.toMatchObject({ name: "RouteBusyError" });
    expect(leaseCalls).toEqual(["observe", "shouldYield"]);
  });

  it("an OTPM refusal is lowered only once: a second one is a normal rate limit, and without a body it waits", async () => {
    const bodies: string[] = [];
    const waits: number[] = [];
    let n = 0;
    const f = providerFetch(
      (async (_u: unknown, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return n++ < 2 ? otpm429() : new Response("{}");
      }) as typeof fetch,
      { sleep: async (ms) => void waits.push(ms) },
    );
    expect((await f("https://x", post())).status).toBe(200);
    expect(bodies.map((b) => JSON.parse(b).max_tokens)).toEqual([undefined, 950, 950]);
    expect(waits).toEqual([32_250]);
    // Without a body there is nothing to lower: the usual Retry-After wait.
    let m = 0;
    const noBody = providerFetch((async () => (m++ === 0 ? otpm429() : new Response("{}"))) as typeof fetch, {
      sleep: async (ms) => void waits.push(ms),
    });
    expect((await noBody("https://x", {})).status).toBe(200);
    expect(waits).toEqual([32_250, 32_250]);
  });

  it("lowers max_tokens on an OTPM refusal that follows an ordinary 429 and its wait", async () => {
    const bodies: string[] = [];
    const waits: number[] = [];
    const script = [() => limited("Rate limit reached on tokens per minute (TPM): Limit 8000. Please try again in 2s."), otpm429];
    const f = providerFetch(
      (async (_u: unknown, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return (script.shift() ?? (() => new Response("{}")))();
      }) as typeof fetch,
      { sleep: async (ms) => void waits.push(ms) },
    );
    expect((await f("https://x", post())).status).toBe(200);
    expect(waits).toEqual([2_250]);
    expect(bodies.map((b) => JSON.parse(b).max_tokens)).toEqual([undefined, undefined, 950]);
  });

  it("a rate-limit 429 (no OTPM) still hands the call to the router when another route is free", async () => {
    const leaseCalls: string[] = [];
    const f = providerFetch(
      (async () => limited("Rate limit reached on tokens per minute (TPM): Limit 8000. Please try again in 5s.")) as typeof fetch,
      { sleep: async () => {}, lease: leaseSpy(leaseCalls) },
    );
    await expect(f("https://x", post())).rejects.toMatchObject({ name: "RouteBusyError" });
    expect(leaseCalls).toEqual(["observe", "shouldYield"]);
  });

  it("a 429 with an empty body waits the usual backoff (no OTPM path)", async () => {
    const waits: number[] = [];
    const bodies: string[] = [];
    let n = 0;
    const f = providerFetch(
      (async (_u: unknown, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return n++ === 0 ? limited("") : new Response("{}");
      }) as typeof fetch,
      { sleep: async (ms) => void waits.push(ms) },
    );
    expect((await f("https://x", post())).status).toBe(200);
    expect(waits).toEqual([5_250]);
    expect(bodies.map((b) => JSON.parse(b).max_tokens)).toEqual([undefined, undefined]);
  });
});
