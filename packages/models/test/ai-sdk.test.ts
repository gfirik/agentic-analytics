// Exercises the real AI SDK path against a stub fetch that speaks the OpenAI chat-completions format.
// No network: every request is answered in-process (AGENTS.md §2.4).
import { describe, expect, it } from "vitest";

// The groq tests deliberately use an endpoint without structured outputs; its warning is expected noise here.
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

import { z } from "zod";
import { createModelClient, ModelError, resolveModelConfig } from "../src/index.ts";

type Reply = { content?: string; tool_calls?: { id: string; name: string; arguments: string }[] };

function stubFetch(replies: Reply[], seen: { url: string; auth: string | null; body: Record<string, unknown> }[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: String(input),
      auth: headers.get("authorization"),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    const r = replies.shift();
    if (!r) return new Response("no more replies", { status: 500 });
    const message = r.tool_calls
      ? {
          role: "assistant",
          content: null,
          tool_calls: r.tool_calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
        }
      : { role: "assistant", content: r.content ?? "" };
    return Response.json({
      id: "cmpl-1",
      object: "chat.completion",
      created: 0,
      model: "stub",
      choices: [{ index: 0, message, finish_reason: r.tool_calls ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
    });
  }) as typeof fetch;
}

describe("AI SDK model client (stubbed transport)", () => {
  it("calls Ollama's OpenAI-compatible endpoint and validates the object", async () => {
    const seen: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const client = createModelClient(resolveModelConfig({ OLLAMA_BASE_URL: "http://ollama.test:11434" }), {
      env: {},
      fetch: stubFetch([{ content: '{"reply":"OK"}' }], seen),
    });
    const res = await client.generateObject({
      role: "planner",
      schema: z.object({ reply: z.string() }),
      system: "health check",
      prompt: "Reply OK.",
    });
    expect(res.object).toEqual({ reply: "OK" });
    expect(res.usage.inputTokens).toBe(7);
    expect(seen[0]?.url).toBe("http://ollama.test:11434/v1/chat/completions");
    expect(seen[0]?.body.model).toBe("qwen3.5:9b");
  });

  it("feeds validation errors back and retries", async () => {
    const seen: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const client = createModelClient(resolveModelConfig({}), {
      env: {},
      fetch: stubFetch([{ content: '{"reply": 1}' }, { content: '{"reply":"OK"}' }], seen),
    });
    const res = await client.generateObject({ role: "judge", schema: z.object({ reply: z.string() }), system: "s", prompt: "p" });
    expect(res.object.reply).toBe("OK");
    expect(JSON.stringify(seen[1]?.body.messages)).toContain("rejected by validation");
  });

  it("treats an endpoint's own JSON-validation refusal (Groq 400 json_validate_failed) as an invalid attempt", async () => {
    const seen: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const ok = stubFetch([{ content: '{"reply":"OK"}' }], seen);
    let first = true;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (first) {
        first = false;
        return Response.json(
          {
            error: {
              message: "Failed to validate JSON. Please adjust your prompt.",
              type: "invalid_request_error",
              code: "json_validate_failed",
            },
          },
          { status: 400 },
        );
      }
      return ok(input, init);
    }) as typeof fetch;
    const env = { PLANNER_MODEL: "openai-compatible:groq:openai/gpt-oss-20b", GROQ_API_KEY: "k" };
    const client = createModelClient(resolveModelConfig(env), { env, fetch: fetchImpl });
    const res = await client.generateObject({ role: "planner", schema: z.object({ reply: z.string() }), system: "s", prompt: "p" });
    expect(res.object.reply).toBe("OK");
    expect(JSON.stringify(seen[0]?.body.messages)).toContain("rejected by validation");
  });

  it("sends the key from the named env var to openai-compatible endpoints", async () => {
    const seen: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const env = { PLANNER_MODEL: "openai-compatible:groq:llama-3.3-70b", GROQ_API_KEY: "test-key" };
    const client = createModelClient(resolveModelConfig(env), { env, fetch: stubFetch([{ content: '{"ok":true}' }], seen) });
    await client.generateObject({ role: "planner", schema: z.object({ ok: z.boolean() }), system: "s", prompt: "p" });
    expect(seen[0]?.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(seen[0]?.auth).toBe("Bearer test-key");
  });

  it("refuses an openai-compatible role when its key is missing", async () => {
    const env = { PLANNER_MODEL: "openai-compatible:groq:llama-3.3-70b" };
    const client = createModelClient(resolveModelConfig(env), { env, fetch: stubFetch([], []) });
    const err = await client.generateObject({ role: "planner", schema: z.object({}), system: "s", prompt: "p" }).catch((e: unknown) => e);
    expect((err as ModelError).code).toBe("MISSING_KEY");
  });

  it("runs a tool loop and reports each step", async () => {
    const seen: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const client = createModelClient(resolveModelConfig({}), {
      env: {},
      fetch: stubFetch(
        [{ tool_calls: [{ id: "c1", name: "get_facts", arguments: '{"ids":["N4"]}' }] }, { content: "Revenue fell {{N4}}." }],
        seen,
      ),
    });
    const res = await client.generateWithTools({
      role: "planner",
      system: "s",
      messages: [{ role: "user", content: "explain" }],
      tools: {
        get_facts: {
          description: "facts",
          inputSchema: z.object({ ids: z.array(z.string()) }),
          execute: async () => [{ id: "N4", value: -17.9 }],
        },
      },
      maxSteps: 4,
    });
    expect(res.steps[0]?.toolCalls[0]).toMatchObject({
      toolName: "get_facts",
      input: { ids: ["N4"] },
      output: [{ id: "N4", value: -17.9 }],
    });
    expect(res.steps.at(-1)?.text).toBe("Revenue fell {{N4}}.");
    expect(seen).toHaveLength(2);
  });

  it("a tool that throws stops the call with that error; its message never goes back to the model", async () => {
    const seen: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const client = createModelClient(resolveModelConfig({}), {
      env: {},
      fetch: stubFetch(
        [{ tool_calls: [{ id: "c1", name: "get_facts", arguments: '{"ids":["N9"]}' }] }, { content: "No such fact." }],
        seen,
      ),
    });
    const call = client.generateWithTools({
      role: "planner",
      system: "s",
      messages: [{ role: "user", content: "explain" }],
      tools: {
        get_facts: {
          description: "facts",
          inputSchema: z.object({ ids: z.array(z.string()) }),
          execute: async () => {
            throw new Error("Conversion Error: could not convert 'cell text' to DOUBLE");
          },
        },
      },
      maxSteps: 4,
    });
    await expect(call).rejects.toThrow("Conversion Error");
    expect(seen).toHaveLength(1);
  });

  it("a call with invalid tool input is reported on that call (error), and the loop goes on", async () => {
    const client = createModelClient(resolveModelConfig({}), {
      env: {},
      fetch: stubFetch([{ tool_calls: [{ id: "c1", name: "get_facts", arguments: '{"ids":"N4"}' }] }, { content: "Retried." }], []),
    });
    const res = await client.generateWithTools({
      role: "planner",
      system: "s",
      messages: [{ role: "user", content: "explain" }],
      tools: {
        get_facts: { description: "facts", inputSchema: z.object({ ids: z.array(z.string()) }), execute: async () => [] },
      },
      maxSteps: 4,
    });
    expect(res.steps[0]?.toolCalls[0]?.toolName).toBe("get_facts");
    expect(res.steps[0]?.toolCalls[0]?.error).toBeDefined();
    expect(res.steps.at(-1)?.text).toBe("Retried.");
  });

  it("maps provider failures to typed errors", async () => {
    const client = createModelClient(resolveModelConfig({}), { env: {}, fetch: stubFetch([], []) });
    const err = await client.generateObject({ role: "planner", schema: z.object({}), system: "s", prompt: "p" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).code).toBe("PROVIDER");
  });

  it("sends the JSON Schema natively to Ollama (structured outputs)", async () => {
    const seen: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const client = createModelClient(resolveModelConfig({}), { env: {}, fetch: stubFetch([{ content: '{"reply":"OK"}' }], seen) });
    await client.generateObject({ role: "planner", schema: z.object({ reply: z.string() }), system: "s", prompt: "p" });
    const format = seen[0]?.body.response_format as { type: string; json_schema?: { schema: { properties: Record<string, unknown> } } };
    expect(format.type).toBe("json_schema");
    expect(Object.keys(format.json_schema?.schema.properties ?? {})).toEqual(["reply"]);
  });

  it("puts the schema in the system prompt when an endpoint lacks structured outputs", async () => {
    const seen: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const env = { PLANNER_MODEL: "openai-compatible:groq:llama-3.3-70b", GROQ_API_KEY: "k" };
    const client = createModelClient(resolveModelConfig(env), { env, fetch: stubFetch([{ content: '{"reply":"OK"}' }], seen) });
    await client.generateObject({ role: "planner", schema: z.object({ reply: z.string() }), system: "health check", prompt: "p" });
    const messages = seen[0]?.body.messages as { role: string; content: string }[];
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("It must match this JSON Schema");
    expect(messages[0]?.content).toContain('"reply"');
  });

  it("lets a config file opt an endpoint into structured outputs", async () => {
    const seen: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const env = { PLANNER_MODEL: "openai-compatible:local:qwen" };
    const file = { providers: { "openai-compatible": { local: { base_url: "http://localhost:1234/v1", structured_outputs: true } } } };
    const client = createModelClient(resolveModelConfig(env, file), { env, fetch: stubFetch([{ content: '{"ok":true}' }], seen) });
    await client.generateObject({ role: "planner", schema: z.object({ ok: z.boolean() }), system: "s", prompt: "p" });
    expect((seen[0]?.body.response_format as { type: string } | undefined)?.type).toBe("json_schema");
  });
});
