// 4. The model router on a scripted transport (learn-data.ts): no network, no keys.
import { type CallRecord, createModelClient, memoryCache, resolveModelConfig } from "@agentic-analytics/models";
import { z } from "zod";

export async function routerRun() {
  // The AI SDK warns that one endpoint has no native JSON-schema mode; the client validates with Zod instead.
  (globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;
  // Two free endpoints serving the same model; the keys are placeholders (the transport never leaves the process).
  const env = {
    PLANNER_MODEL: "openai-compatible:groq:openai/gpt-oss-120b | openai-compatible:cerebras:gpt-oss-120b",
    GROQ_API_KEY: "placeholder-not-a-key",
    CEREBRAS_API_KEY: "placeholder-not-a-key",
  };
  const answer = { finding: "F1", grade: "document_supported" };
  const reply = (content: string) =>
    Response.json({
      id: "c",
      object: "chat.completion",
      created: 0,
      model: "gpt-oss-120b",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 412, completion_tokens: 18, total_tokens: 430 },
    });
  const script: Record<string, (() => Response)[]> = {
    "api.groq.com": [
      () =>
        new Response(
          JSON.stringify({
            error: { message: "Rate limit reached for model openai/gpt-oss-120b: tokens per minute. Please try again in 24.7s." },
          }),
          {
            status: 429,
            headers: { "retry-after": "25", "x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "24.7s" },
          },
        ),
    ],
    // The first answer breaks the schema (a grade that doesn't exist); the client feeds the error back and asks again.
    "api.cerebras.ai": [() => reply('{"finding":"F1","grade":"proven"}'), () => reply(JSON.stringify(answer))],
  };
  const transport = (async (input: string | URL | Request) => {
    const next = script[new URL(String(input instanceof Request ? input.url : input)).host]?.shift();
    return next ? next() : new Response("no script", { status: 500 });
  }) as typeof fetch;
  const calls: CallRecord[] = [];
  const client = createModelClient(resolveModelConfig(env), { env, fetch: transport, cache: memoryCache(), onCall: (c) => calls.push(c) });
  const schema = z.object({ finding: z.string(), grade: z.enum(["observed", "correlated", "document_supported"]) });
  const r = await client.generateObject({ role: "planner", schema, system: "Grade the finding.", prompt: "F1" });
  // The same request again: served from the response cache, and the log says so.
  await client.generateObject({ role: "planner", schema, system: "Grade the finding.", prompt: "F1" });
  return {
    spec: env.PLANNER_MODEL,
    calls: calls.map((c) => ({
      role: c.role ?? "",
      provider: c.provider,
      endpoint: c.endpoint ?? null,
      model: c.model,
      status: c.status,
      cached: c.cached,
      inputTokens: c.inputTokens ?? null,
      outputTokens: c.outputTokens ?? null,
      error: c.error ?? null,
    })),
    answer: r.object as unknown,
  };
}
