# Spec: model layer (`packages/models`)

## 1. Why a layer

The engine must run on any model. That means local Ollama today, free hosted endpoints while developing, and paid providers later for people who want them. It must never depend on one model's quirks.

The Vercel AI SDK (`ai`, Apache-2.0, a plain library that needs no Vercel platform) gives us three things:

- a single call style across providers;
- structured output validated against Zod, with retries;
- normalized tool calling and streaming.

We wrap it in our own `ModelClient`, so the engine never imports `ai` directly and the SDK can be swapped (TanStack AI, or the plain `openai` client) if needed.

## 2. Interface

```ts
interface ModelClient {
  generateObject<T>(args: { role: Role; schema: ZodType<T>; system: string; prompt: string; maxRetries?: number }): Promise<{ object: T; usage: Usage }>;
  generateWithTools(args: { role: Role; system: string; messages: Message[]; tools: ToolSet; maxSteps: number }): Promise<{ steps: Step[]; usage: Usage }>;
  embed(texts: string[]): Promise<number[][]>;
}
type Role = "planner" | "extractor" | "judge";
```

## 3. Providers in v0.x (free only)

| Provider id | Covers | Notes |
|---|---|---|
| `ollama` | Any local Ollama model | Optional. Uses Ollama's OpenAI-compatible endpoint. |
| `transformers` | In-process ONNX embeddings and reranker (`@huggingface/transformers`) | Default for embeddings. Nothing to install. |
| `openai-compatible` | Groq, OpenRouter (free models), Cerebras, GitHub Models, Google AI Studio OpenAI-compat, LM Studio, vLLM | Base URL + key from env. All free tiers need no credit card. |

Always configure a provider explicitly. Never fall back to the AI SDK's default gateway.

Paid providers (`@ai-sdk/anthropic`, `@ai-sdk/openai`) are **not** added before milestone M13.

## 4. Config (`agentic-analytics.config.yaml` or env)

```yaml
models:
  planner:   { provider: ollama, model: qwen3.5:9b }
  extractor: { provider: ollama, model: qwen3.5:9b }
  judge:     { provider: ollama, model: qwen3.5:9b }
  embedder:  { provider: transformers, model: Xenova/bge-m3 }   # in-process ONNX, no Ollama needed
providers:
  ollama: { base_url: http://localhost:11434 }
  openai-compatible:
    groq: { base_url: https://api.groq.com/openai/v1, api_key_env: GROQ_API_KEY }
```

Roles that use `openai-compatible` name their endpoint: `planner: { provider: openai-compatible, endpoint: groq, model: llama-3.3-70b-versatile }`. Env overrides use the same shape as one string: `PLANNER_MODEL=ollama:qwen3.5:9b`, `PLANNER_MODEL=openai-compatible:groq:llama-3.3-70b-versatile`, `EMBEDDING_MODEL=transformers:Xenova/bge-m3`. Built-in endpoint presets are `groq`, `openrouter`, `cerebras`, `nvidia-nim`, `google-ai-studio`, `sambanova`, `mistral` (https://api.mistral.ai/v1, MISTRAL_API_KEY) and `cloudflare`. Cloudflare's base URL takes `${CLOUDFLARE_ACCOUNT_ID}` from the environment. `github-models` was removed because the service retired on 2026-07-30. The presets can be overridden or extended in the config file. A role can list the same model on several providers, `PLANNER_MODEL=openai-compatible:nvidia-nim:openai/gpt-oss-120b|openai-compatible:groq:openai/gpt-oss-120b` (or `fallbacks:` in the file). Every route must name the same model (compared by the id after the last "/"), or the config is refused. An endpoint sets `structured_outputs: true` when its models accept `response_format: json_schema`; otherwise the schema is sent in the system prompt. Ollama always uses native structured outputs.

Model profiles (`packages/models/src/profiles.ts`) record per-model facts: context size, tool-calling reliability, JSON-mode support, and whether small-model mode applies. They are filled in from eval results.

## 5. Reliability

- **Structured output:** validated by Zod. On failure, retry up to 2 times with the validation error fed back. After that, the stage degrades gracefully (fewer findings) and logs it.
- **Timeouts:** 120s per call by default, longer for local CPU models (`MODEL_TIMEOUT_MS`).
- **Usage:** tokens and latency are recorded per role in job events, so evals can report cost and speed.
- **Router** (M13a). Each route (provider + model) has a token bucket fed by the `x-ratelimit-remaining-*` and `x-ratelimit-reset-*` headers, and by 429s with their `retry-after`:
  - A call goes to the first route with capacity.
  - On a 429 before any of the call's requests succeeded, it moves to the next route of the **same model**. Mid tool-loop it waits instead, so tools are never re-run.
  - When every route is limited, it waits for the soonest, up to 90 s, then stops with `RATE_LIMITED`, naming each route and when it frees up.
  - It never switches models.
- **Two kinds of call.** A structured-output call carries no tools, and a tool loop asks for no structured output (enforced by a transport test).
- **Response cache.** Responses are keyed by SHA-256 of the URL and request body (model, messages, parameters); only successful responses are stored. Tools still run on replay, so cached runs give the same facts. It is on for `aa eval` (`evals/.cache/`), and on elsewhere with `AA_MODEL_CACHE=<dir>`. A cached answer is served even while every route is rate-limited: the router lets a call probe the cache on each route before it waits or stops with `RATE_LIMITED`, and a miss sends nothing. A tool loop whose cached steps were served stays on that route: its next live step waits for the route (or stops), so tools never run twice (M13h).
- **Call log.** Every call reports role, provider, endpoint, model as sent, status, cached, latency and tokens. The CLI appends it to `data/logs/model-calls.jsonl` (stderr too with `AA_LOG_CALLS=1`), and eval results record calls per route. No prompt or answer text is logged.

## 6. Testing

- `FakeModel` (`packages/models/testing`) returns scripted responses keyed by role and prompt hash (or substring). A response can be a function of the request, for scripts that must name ids only known at run time. Example: `packages/core/testing/coffee-planner.ts` reads fact and extract ids from the prompt, as a model would.
- All unit and integration tests use `FakeModel`. CI never needs a network model or a key.
- Real-model evals run on demand: `aa eval --model <profile>`.

## 7. Choosing models

The project doesn't depend on any one model. During development, use whatever free option is fastest. That's usually a free hosted endpoint for speed, or a small Ollama model for full privacy.

The officially supported model list and the default are decided at the end, from eval scores (docs/EVALS.md). Never decide it from launch headlines.
