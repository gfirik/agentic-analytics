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

Model profiles (`packages/models/profiles.ts`) record per-model facts: context size, tool-calling reliability, JSON-mode support, and whether small-model mode applies. They are filled in from eval results.

## 5. Reliability

- **Structured output:** validated by Zod. On failure, retry up to 2 times with the validation error fed back. After that, the stage degrades gracefully (fewer findings) and logs it.
- **Timeouts:** 120s per call by default, longer for local CPU models (`MODEL_TIMEOUT_MS`).
- **Usage:** tokens and latency are recorded per role in job events, so evals can report cost and speed.

## 6. Testing

- `FakeModel` (`packages/models/testing`) returns scripted responses keyed by role and prompt hash.
- All unit and integration tests use `FakeModel`. CI never needs a network model or a key.
- Real-model evals run on demand: `aa eval --model <profile>`.

## 7. Choosing models

The project doesn't depend on any one model. During development, use whatever free option is fastest. That's usually a free hosted endpoint for speed, or a small Ollama model for full privacy.

The officially supported model list and the default are decided at the end, from eval scores (docs/EVALS.md). Never decide it from launch headlines.
