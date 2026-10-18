// The provider router (M13a): the same model on several free providers. Scripted transports, a fake clock, no
// network.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type CallRecord,
  createModelClient,
  durationMs,
  expandUrl,
  ModelError,
  maskSecrets,
  memoryCache,
  providerFetch,
  Router,
  readRateHeaders,
  resolveModelConfig,
} from "../src/index.ts";

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const ok = (content: string, headers: Record<string, string> = {}) =>
  Response.json(
    {
      id: "c",
      object: "chat.completion",
      created: 0,
      model: "m",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    },
    { headers },
  );
const limited = (retryAfter: string) => new Response("rate limited", { status: 429, headers: { "retry-after": retryAfter } });

/** A transport per host: each host answers from its own script; every request is recorded. */
function hosts(script: Record<string, (() => Response)[]>) {
  const seen: { host: string; model: string; body: Record<string, unknown> }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    seen.push({ host: url.host, model: String(body.model), body });
    const next = script[url.host]?.shift();
    return next ? next() : new Response("no script", { status: 500 });
  }) as typeof fetch;
  return { f, seen };
}

const env = {
  PLANNER_MODEL: "openai-compatible:nvidia-nim:openai/gpt-oss-120b|openai-compatible:groq:openai/gpt-oss-120b",
  NVIDIA_API_KEY: "n",
  GROQ_API_KEY: "g",
};
const schema = z.object({ reply: z.string() });

describe("config", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the test name quotes the ${VAR} syntax of base URLs
  it("has the new presets and no github-models; fills ${VAR} in base URLs", () => {
    const c = resolveModelConfig({ CLOUDFLARE_ACCOUNT_ID: "acc123" });
    const p = c.providers["openai-compatible"] ?? {};
    expect(Object.keys(p).sort()).toEqual([
      "cerebras",
      "cloudflare",
      "google-ai-studio",
      "groq",
      "mistral",
      "nvidia-nim",
      "openrouter",
      "sambanova",
    ]);
    expect(p.mistral).toMatchObject({ base_url: "https://api.mistral.ai/v1", api_key_env: "MISTRAL_API_KEY" });
    expect(p["nvidia-nim"]).toMatchObject({ base_url: "https://integrate.api.nvidia.com/v1", api_key_env: "NVIDIA_API_KEY" });
    expect(p.cloudflare?.base_url).toBe("https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1");
  });

  it("parses routes for one model and refuses a route that names another model", () => {
    expect(resolveModelConfig(env).models.planner).toMatchObject({
      endpoint: "nvidia-nim",
      fallbacks: [{ provider: "openai-compatible", endpoint: "groq", model: "openai/gpt-oss-120b" }],
    });
    const mixed = { PLANNER_MODEL: "openai-compatible:nvidia-nim:moonshotai/kimi-k3|openai-compatible:groq:openai/gpt-oss-120b" };
    expect(() => resolveModelConfig(mixed)).toThrowError(/every route of a role must be the same model/);
  });

  it("reads rate-limit headers and durations", () => {
    expect(durationMs("2m59.56s")).toBeCloseTo(179_560, 6);
    expect(durationMs("640ms")).toBe(640);
    expect(durationMs("7")).toBe(7000);
    const h = readRateHeaders(new Headers({ "x-ratelimit-remaining-tokens": "120", "x-ratelimit-reset-tokens": "7.66s" }));
    expect(h).toEqual({ remainingTokens: 120, resetTokensMs: 7660 });
  });
});

describe("router", () => {
  it("falls back to the same model on another provider when the first is rate-limited, and logs both", async () => {
    const t = hosts({ "integrate.api.nvidia.com": [() => limited("30")], "api.groq.com": [() => ok('{"reply":"OK"}')] });
    const calls: CallRecord[] = [];
    const client = createModelClient(resolveModelConfig(env), { env, fetch: t.f, onCall: (c) => calls.push(c) });
    const r = await client.generateObject({ role: "planner", schema, system: "s", prompt: "p" });
    expect(r.object.reply).toBe("OK");
    expect(t.seen.map((s) => [s.host, s.model])).toEqual([
      ["integrate.api.nvidia.com", "openai/gpt-oss-120b"],
      ["api.groq.com", "openai/gpt-oss-120b"],
    ]);
    expect(calls.map((c) => [c.role, c.endpoint, c.model, c.status, c.cached])).toEqual([
      ["planner", "nvidia-nim", "openai/gpt-oss-120b", 429, false],
      ["planner", "groq", "openai/gpt-oss-120b", 200, false],
    ]);
  });

  it("skips a route whose bucket the headers said is empty, until it refills", async () => {
    let now = 0;
    const router = new Router({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    const t = hosts({
      "integrate.api.nvidia.com": [
        () => ok('{"reply":"A"}', { "x-ratelimit-remaining-requests": "0", "x-ratelimit-reset-requests": "20s" }),
        () => ok('{"reply":"C"}'),
      ],
      "api.groq.com": [() => ok('{"reply":"B"}')],
    });
    const client = createModelClient(resolveModelConfig(env), { env, fetch: t.f, router });
    const a = await client.generateObject({ role: "planner", schema, system: "s", prompt: "1" });
    const b = await client.generateObject({ role: "planner", schema, system: "s", prompt: "2" });
    now += 21_000;
    const c = await client.generateObject({ role: "planner", schema, system: "s", prompt: "3" });
    expect([a.object.reply, b.object.reply, c.object.reply]).toEqual(["A", "B", "C"]);
    expect(t.seen.map((s) => s.host)).toEqual(["integrate.api.nvidia.com", "api.groq.com", "integrate.api.nvidia.com"]);
  });

  it("stops with RATE_LIMITED, naming every route, instead of switching models", async () => {
    let now = 0;
    const router = new Router({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      maxWaitMs: 60_000,
    });
    const t = hosts({ "integrate.api.nvidia.com": [() => limited("600")], "api.groq.com": [() => limited("900")] });
    const client = createModelClient(resolveModelConfig(env), { env, fetch: t.f, router });
    const err = await client.generateObject({ role: "planner", schema, system: "s", prompt: "p" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).code).toBe("RATE_LIMITED");
    expect((err as ModelError).message).toMatch(
      /nvidia-nim:openai\/gpt-oss-120b for \d+ s; openai-compatible:groq:openai\/gpt-oss-120b for \d+ s/,
    );
    expect(new Set(t.seen.map((s) => s.model))).toEqual(new Set(["openai/gpt-oss-120b"]));
  });
});

describe("cache while every route is limited", () => {
  it("serves a cached call even after a 429 blocked the route; an uncached one stops without a request", async () => {
    let now = 0;
    const router = new Router({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      maxWaitMs: 60_000,
    });
    const genv = { PLANNER_MODEL: "openai-compatible:groq:qwen/qwen3.8-27b", GROQ_API_KEY: "g" };
    const t = hosts({ "api.groq.com": [() => ok('{"reply":"cached"}'), () => limited("600")] });
    const calls: CallRecord[] = [];
    const client = createModelClient(resolveModelConfig(genv), {
      env: genv,
      fetch: t.f,
      router,
      cache: memoryCache(),
      onCall: (c) => calls.push(c),
    });
    const ask = (prompt: string) => client.generateObject({ role: "planner", schema, system: "s", prompt });
    await ask("finished yesterday");
    // A new request hits the daily limit: the route is blocked for 600 s, longer than the router waits.
    expect(((await ask("new").catch((e: unknown) => e)) as ModelError).code).toBe("RATE_LIMITED");
    expect(t.seen).toHaveLength(2);
    // The finished call is still free: it comes from the cache, with no request and no wait.
    expect((await ask("finished yesterday")).object).toEqual({ reply: "cached" });
    expect(calls.at(-1)?.cached).toBe(true);
    // An uncached call still stops with RATE_LIMITED, and sends nothing while the route is blocked.
    expect(((await ask("another new").catch((e: unknown) => e)) as ModelError).code).toBe("RATE_LIMITED");
    expect(t.seen).toHaveLength(2);
    expect(now).toBe(0);
  });

  it("a tool loop whose first step is cached stays on its route: the tool runs once, the next step waits", async () => {
    let now = 0;
    const router = new Router({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      maxWaitMs: 60_000,
    });
    const genv = { PLANNER_MODEL: "openai-compatible:groq:qwen/qwen3.8-27b", GROQ_API_KEY: "g" };
    const toolCall = () =>
      Response.json({
        id: "c",
        object: "chat.completion",
        created: 0,
        model: "m",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "t1", type: "function", function: { name: "count", arguments: "{}" } }],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    // Run 1 records the tool step; run 2 replays it from the cache, then its next step (the tool's output differs)
    // is live while the route is blocked for 10 s.
    const t = hosts({ "api.groq.com": [toolCall, () => ok("done"), () => ok("done again")] });
    let runs = 0;
    const tools = { count: { description: "count", inputSchema: z.object({}), execute: async () => ({ n: ++runs }) } };
    const client = createModelClient(resolveModelConfig(genv), { env: genv, fetch: t.f, router, cache: memoryCache() });
    const loop = () =>
      client.generateWithTools({ role: "planner", system: "s", messages: [{ role: "user", content: "go" }], tools, maxSteps: 3 });
    await loop();
    router.block({ provider: "openai-compatible", endpoint: "groq", model: "qwen/qwen3.8-27b" }, 10_000);
    await loop();
    // One tool run per loop: re-running the loop after the cached step would have run it a third time.
    expect(runs).toBe(2);
    expect(t.seen).toHaveLength(3);
    expect(now).toBeGreaterThanOrEqual(10_000);
  });

  it("finds an answer cached on the fallback route while the primary frees up sooner", async () => {
    let now = 0;
    const router = new Router({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      maxWaitMs: 60_000,
    });
    const t = hosts({ "api.groq.com": [() => ok('{"reply":"from groq"}')] });
    const cache = memoryCache();
    const client = createModelClient(resolveModelConfig(env), { env, fetch: t.f, router, cache });
    const nim = { provider: "openai-compatible" as const, endpoint: "nvidia-nim", model: "openai/gpt-oss-120b" };
    const groq = { provider: "openai-compatible" as const, endpoint: "groq", model: "openai/gpt-oss-120b" };
    // Recorded on the fallback while the primary was limited.
    router.block(nim, 5_000);
    await client.generateObject({ role: "planner", schema, system: "s", prompt: "p" });
    // Both limited now, the primary sooner (but past the router's wait): the fallback's cached answer is served.
    router.block(nim, 120_000);
    router.block(groq, 600_000);
    const res = await client.generateObject({ role: "planner", schema, system: "s", prompt: "p" });
    expect(res.object).toEqual({ reply: "from groq" });
    expect(t.seen).toHaveLength(1);
  });

  const toolStep = () =>
    Response.json({
      id: "c",
      object: "chat.completion",
      created: 0,
      model: "m",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "t1", type: "function", function: { name: "count", arguments: "{}" } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

  it("waits for a primary that frees up soon rather than committing to a fallback it would not wait for", async () => {
    let now = 0;
    const router = new Router({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      maxWaitMs: 60_000,
    });
    // Run 1 on the fallback (primary limited) records the tool step there. Run 2: primary frees in 30 s with nothing
    // cached; the fallback is limited for 600 s, past the router's wait, though its first step is cached.
    const t = hosts({
      "api.groq.com": [toolStep, () => ok("done")],
      "integrate.api.nvidia.com": [toolStep, () => ok("done on nim")],
    });
    let runs = 0;
    const tools = { count: { description: "count", inputSchema: z.object({}), execute: async () => ({ n: ++runs }) } };
    const client = createModelClient(resolveModelConfig(env), { env, fetch: t.f, router, cache: memoryCache() });
    const nim = { provider: "openai-compatible" as const, endpoint: "nvidia-nim", model: "openai/gpt-oss-120b" };
    const groq = { provider: "openai-compatible" as const, endpoint: "groq", model: "openai/gpt-oss-120b" };
    const loop = () =>
      client.generateWithTools({ role: "planner", system: "s", messages: [{ role: "user", content: "go" }], tools, maxSteps: 3 });
    router.block(nim, 5_000);
    await loop();
    expect(runs).toBe(1);
    now = 10_000;
    router.block(nim, 30_000);
    router.block(groq, 600_000);
    await loop();
    // One tool run in the second call, on the primary after its 30 s wait.
    expect(runs).toBe(2);
    expect(t.seen.map((s) => s.host)).toEqual(["api.groq.com", "api.groq.com", "integrate.api.nvidia.com", "integrate.api.nvidia.com"]);
    expect(now).toBeGreaterThanOrEqual(40_000);
  });

  it("a probe that served a cached step stops with RATE_LIMITED when its route stays limited too long", async () => {
    let now = 0;
    const router = new Router({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      maxWaitMs: 60_000,
    });
    const genv = { PLANNER_MODEL: "openai-compatible:groq:qwen/qwen3.8-27b", GROQ_API_KEY: "g" };
    const t = hosts({ "api.groq.com": [toolStep, () => ok("done")] });
    let runs = 0;
    const tools = { count: { description: "count", inputSchema: z.object({}), execute: async () => ({ n: ++runs }) } };
    const client = createModelClient(resolveModelConfig(genv), { env: genv, fetch: t.f, router, cache: memoryCache() });
    const loop = () =>
      client.generateWithTools({ role: "planner", system: "s", messages: [{ role: "user", content: "go" }], tools, maxSteps: 3 });
    await loop();
    router.block({ provider: "openai-compatible", endpoint: "groq", model: "qwen/qwen3.8-27b" }, 600_000);
    const err = await loop().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).code).toBe("RATE_LIMITED");
    // The cached step ran its tool once; the live step was never sent.
    expect(runs).toBe(2);
    expect(t.seen).toHaveLength(2);
    // Past the router's own cap (60 s) but within providerFetch's (90 s): it stops at once too, without waiting.
    router.block({ provider: "openai-compatible", endpoint: "groq", model: "qwen/qwen3.8-27b" }, 75_000);
    const start = now;
    expect(((await loop().catch((e: unknown) => e)) as ModelError).code).toBe("RATE_LIMITED");
    expect(runs).toBe(3);
    expect(t.seen).toHaveLength(2);
    expect(now).toBe(start);
  });
});

describe("cache and the two kinds of call", () => {
  it("serves a repeated request from the cache, and says so in the call log", async () => {
    const t = hosts({ "api.groq.com": [() => ok('{"reply":"OK"}')] });
    const calls: CallRecord[] = [];
    const genv = { PLANNER_MODEL: "openai-compatible:groq:openai/gpt-oss-20b", GROQ_API_KEY: "g" };
    const cache = memoryCache();
    const client = createModelClient(resolveModelConfig(genv), { env: genv, fetch: t.f, cache, onCall: (c) => calls.push(c) });
    for (let i = 0; i < 2; i++) await client.generateObject({ role: "planner", schema, system: "s", prompt: "same" });
    expect(t.seen).toHaveLength(1);
    expect(calls.map((c) => c.cached)).toEqual([false, true]);
    expect(cache.size).toBe(1);
  });

  it("an object call carries no tools; a tool loop asks for no structured output", async () => {
    const t = hosts({
      "api.groq.com": [
        () => ok('{"reply":"OK"}'),
        () =>
          Response.json({
            id: "c",
            object: "chat.completion",
            created: 0,
            model: "m",
            choices: [{ index: 0, message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
      ],
    });
    const genv = { PLANNER_MODEL: "openai-compatible:groq:openai/gpt-oss-20b", GROQ_API_KEY: "g" };
    const client = createModelClient(resolveModelConfig(genv), { env: genv, fetch: t.f });
    await client.generateObject({ role: "planner", schema, system: "s", prompt: "p" });
    await client.generateWithTools({
      role: "planner",
      system: "s",
      messages: [{ role: "user", content: "go" }],
      tools: { noop: { description: "noop", inputSchema: z.object({}), execute: async () => ({}) } },
      maxSteps: 2,
    });
    const [object, loop] = t.seen;
    expect(object?.body.tools).toBeUndefined();
    expect(loop?.body.tools).toBeDefined();
    expect(loop?.body.response_format).toBeUndefined();
  });

  it("a cached tool step pins the call to its route: a 429 on the next step waits instead of re-running tools", async () => {
    const toolCall = () =>
      Response.json({
        id: "c",
        object: "chat.completion",
        created: 0,
        model: "m",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "t1", type: "function", function: { name: "count", arguments: "{}" } }],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    // Run 1: tool step, then the answer. Run 2: the tool step comes from the cache; the tool's output differs (a
    // counter), so the next step is live and is rate-limited once (retry-after 1 s) before it succeeds.
    const t = hosts({
      "integrate.api.nvidia.com": [toolCall, () => ok("done"), () => limited("1"), () => ok("done")],
      "api.groq.com": [toolCall, () => ok("done")],
    });
    let runs = 0;
    const tools = { count: { description: "count", inputSchema: z.object({}), execute: async () => ({ n: ++runs }) } };
    const client = createModelClient(resolveModelConfig(env), { env, fetch: t.f, cache: memoryCache() });
    const loop = () =>
      client.generateWithTools({ role: "planner", system: "s", messages: [{ role: "user", content: "go" }], tools, maxSteps: 3 });
    await loop();
    await loop();
    // One tool run per logical step: 2 in all. Yielding to Groq would have restarted the loop and run it a third time.
    expect(runs).toBe(2);
    expect(t.seen.map((x) => x.host)).not.toContain("api.groq.com");
  });
});

describe("router bounds", () => {
  it("stops with RATE_LIMITED when a provider keeps answering 429 without retry-after, instead of looping", async () => {
    let now = 0;
    const router = new Router({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    let requests = 0;
    const route = { provider: "openai-compatible" as const, endpoint: "google-ai-studio", model: "gemini" };
    const err = await router
      .run([route], async () => {
        requests++;
        throw Object.assign(new Error("429"), { statusCode: 429, responseHeaders: {} });
      })
      .catch((e: unknown) => e);
    expect((err as ModelError).code).toBe("RATE_LIMITED");
    // No retry-after → a 60 s block; the first wait fits the 90 s budget, the second (60 + 60 > 90) doesn't.
    expect(requests).toBe(2);
    expect(now).toBeLessThanOrEqual(90_000);
  });

  it("caps attempts per call even when every wait is short", async () => {
    let now = 0;
    const router = new Router({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    let requests = 0;
    const route = { provider: "openai-compatible" as const, endpoint: "groq", model: "m" };
    const err = await router
      .run([route], async () => {
        requests++;
        throw Object.assign(new Error("429"), { statusCode: 429, responseHeaders: { "retry-after": "1" } });
      })
      .catch((e: unknown) => e);
    expect((err as ModelError).code).toBe("RATE_LIMITED");
    // 4 attempts per route, plus the first: at most 5 requests, ~1 s apart.
    expect(requests).toBeLessThanOrEqual(5);
  });

  it("caches only complete answers, ignores epoch-looking resets, and fills only *_ACCOUNT_ID in URLs", async () => {
    const cut = () =>
      Response.json({
        id: "c",
        object: "chat.completion",
        created: 0,
        model: "m",
        choices: [{ index: 0, message: { role: "assistant", content: '{"reply":"O' }, finish_reason: "length" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    const t = hosts({ "api.groq.com": [cut, () => Response.json({ error: { message: "upstream" } })] });
    const genv = { PLANNER_MODEL: "openai-compatible:groq:openai/gpt-oss-20b", GROQ_API_KEY: "g" };
    const cache = memoryCache();
    const lm = createModelClient(resolveModelConfig(genv), { env: genv, fetch: t.f, cache });
    await lm.generateObject({ role: "planner", schema, system: "s", prompt: "p", maxRetries: 0 }).catch(() => undefined);
    expect(cache.size).toBe(0);
    expect(readRateHeaders(new Headers({ "x-ratelimit-reset-requests": "1760000000" }))).toEqual({});
    // biome-ignore lint/suspicious/noTemplateCurlyInString: ${VAR} placeholders, not JS templates
    expect(expandUrl("https://x/${CLOUDFLARE_ACCOUNT_ID}/${GROQ_API_KEY}", { CLOUDFLARE_ACCOUNT_ID: "a", GROQ_API_KEY: "secret" })).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: as above
      "https://x/a/${GROQ_API_KEY}",
    );
  });

  it("logs a failed call with the provider's short error message, keys masked", async () => {
    const t = hosts({ "api.groq.com": [() => Response.json({ error: { message: "Invalid key gsk_abc123 for org" } }, { status: 401 })] });
    const calls: CallRecord[] = [];
    const genv = { PLANNER_MODEL: "openai-compatible:groq:openai/gpt-oss-20b", GROQ_API_KEY: "g" };
    const lm = createModelClient(resolveModelConfig(genv), { env: genv, fetch: t.f, onCall: (c) => calls.push(c) });
    await lm.generateObject({ role: "planner", schema, system: "s", prompt: "p", maxRetries: 0 }).catch(() => undefined);
    expect(calls.map((c) => [c.status, c.error])).toEqual([[401, "Invalid key gsk_*** for org"]]);
  });

  it("logs a request that got no response, and retries a reset connection before any response", async () => {
    let n = 0;
    const f = (async () => {
      n++;
      if (n === 1) throw new TypeError("fetch failed", { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) });
      return ok('{"reply":"OK"}');
    }) as typeof fetch;
    const calls: CallRecord[] = [];
    const genv = { PLANNER_MODEL: "openai-compatible:groq:openai/gpt-oss-20b", GROQ_API_KEY: "g" };
    const pf = providerFetch(f, { sleep: async () => {}, onCall: (c) => calls.push(c), label: { provider: "openai-compatible" } });
    const res = await pf("https://api.groq.com/openai/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "m" }) });
    expect(res.status).toBe(200);
    expect(calls.map((c) => [c.status, c.error])).toEqual([
      [0, "TypeError: fetch failed (ECONNRESET)"],
      [200, undefined],
    ]);
    // A timeout is logged but not retried.
    const slow = providerFetch(
      (async () => {
        throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      }) as typeof fetch,
      { sleep: async () => {}, onCall: (c) => calls.push(c) },
    );
    await expect(slow("https://x/v1/chat/completions", { method: "POST", body: "{}" })).rejects.toThrow("timed out");
    expect(calls.at(-1)?.error).toBe("TimeoutError: timed out");
    void genv;
  });

  it("masks configured keys of any format, and key-like prefixes, in errors a client throws", async () => {
    expect(maskSecrets("bad key csk-abcdef123 and Bearer xyz12345", [])).toBe("bad key csk-*** and Bearer ***");
    const t = hosts({
      "api.mistral.ai": [() => Response.json({ error: { message: "key Zq9mistralKEY77 is not activated" } }, { status: 401 })],
    });
    const menv = { PLANNER_MODEL: "openai-compatible:mistral:mistral-small-2603", MISTRAL_API_KEY: "Zq9mistralKEY77" };
    const lm = createModelClient(resolveModelConfig(menv), { env: menv, fetch: t.f });
    const err = await lm.generateObject({ role: "planner", schema, system: "s", prompt: "p", maxRetries: 0 }).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain("Zq9mistralKEY77");
    expect((err as Error).message).toContain("***");
  });

  it("masks keys in the thrown error's cause chain and in call records; word-bounded, any-case bearer", async () => {
    expect(maskSecrets("model whisk-large-v2 and task-12345 failed")).toBe("model whisk-large-v2 and task-12345 failed");
    expect(maskSecrets("authorization: bearer abcd1234")).toBe("authorization: bearer ***");
    const body = { error: { message: "key Zq9mistralKEY77 is not activated" } };
    const t = hosts({ "api.mistral.ai": [() => Response.json(body, { status: 401 })] });
    const calls: CallRecord[] = [];
    const menv = { PLANNER_MODEL: "openai-compatible:mistral:mistral-small-2603", MISTRAL_API_KEY: "Zq9mistralKEY77" };
    const lm = createModelClient(resolveModelConfig(menv), { env: menv, fetch: t.f, onCall: (c) => calls.push(c) });
    const err = await lm.generateObject({ role: "planner", schema, system: "s", prompt: "p", maxRetries: 0 }).catch((e: unknown) => e);
    let chain = "";
    for (let e: unknown = err; e instanceof Error; e = e.cause) chain += ` ${e.message}`;
    expect(chain).not.toContain("Zq9mistralKEY77");
    expect(JSON.stringify(calls)).not.toContain("Zq9mistralKEY77");
    expect(calls[0]?.error).toBe("key *** is not activated");
  });
  it("masks the provider's organization id like a key, in call records and in the error a client throws", async () => {
    expect(maskSecrets("Rate limit reached in organization `org_01jq3x5v8k2m4n6p7r9s0t1w2y` service tier on_demand")).toBe(
      "Rate limit reached in organization `org_***` service tier on_demand",
    );
    // Only Groq's ULID form: identifiers that merely contain or start with "org_" stay readable.
    expect(maskSecrets("column my_org_name, org_id, org_name and org_region_code")).toBe(
      "column my_org_name, org_id, org_name and org_region_code",
    );
    const message = "Request too large in organization `org_01jq3x5v8k2m4n6p7r9s0t1w2y` on tokens per minute (TPM): Limit 8000";
    const t = hosts({ "api.groq.com": [() => Response.json({ error: { message } }, { status: 400 })] });
    const calls: CallRecord[] = [];
    const genv = { PLANNER_MODEL: "openai-compatible:groq:openai/gpt-oss-20b", GROQ_API_KEY: "g" };
    const lm = createModelClient(resolveModelConfig(genv), { env: genv, fetch: t.f, onCall: (c) => calls.push(c) });
    const err = await lm.generateObject({ role: "planner", schema, system: "s", prompt: "p", maxRetries: 0 }).catch((e: unknown) => e);
    let chain = "";
    for (let e: unknown = err; e instanceof Error; e = e.cause) chain += ` ${e.message}`;
    expect(chain).not.toContain("org_01jq3x5v8k2m4n6p7r9s0t1w2y");
    expect(JSON.stringify(calls)).not.toContain("org_01jq3x5v8k2m4n6p7r9s0t1w2y");
    expect(calls[0]?.error).toBe("Request too large in organization `org_***` on tokens per minute (TPM): Limit 8000");
  });
  it("masks keys and org ids in INVALID_OUTPUT, which quotes the last answer's validation error", async () => {
    const t = hosts({ "api.groq.com": [() => ok("not json: org_01jq3x5v8k2m4n6p7r9s0t1w2y gsk_leakedKey123")] });
    const genv = { PLANNER_MODEL: "openai-compatible:groq:openai/gpt-oss-20b", GROQ_API_KEY: "g" };
    const lm = createModelClient(resolveModelConfig(genv), { env: genv, fetch: t.f });
    const err = await lm.generateObject({ role: "planner", schema, system: "s", prompt: "p", maxRetries: 0 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).code).toBe("INVALID_OUTPUT");
    expect((err as Error).message).not.toMatch(/org_01jq3x5v8k2m4n6p7r9s0t1w2y|gsk_leakedKey123/);
  });
});
