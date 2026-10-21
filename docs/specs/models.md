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

Roles that use `openai-compatible` name their endpoint: `planner: { provider: openai-compatible, endpoint: groq, model: llama-3.3-70b-versatile }`. Env overrides use the same shape as one string: `PLANNER_MODEL=ollama:qwen3.5:9b`, `PLANNER_MODEL=openai-compatible:groq:llama-3.3-70b-versatile`, `EMBEDDING_MODEL=transformers:Xenova/bge-m3`. Built-in endpoint presets are `groq`, `openrouter`, `cerebras`, `nvidia-nim`, `google-ai-studio`, `sambanova`, `mistral` (https://api.mistral.ai/v1, MISTRAL_API_KEY) and `cloudflare`. Cloudflare's base URL takes `${CLOUDFLARE_ACCOUNT_ID}` from the environment. `github-models` was removed because the service retired on 2026-07-30. The presets can be overridden or extended in the config file. A role can list the same model on several providers, `PLANNER_MODEL=openai-compatible:nvidia-nim:openai/gpt-oss-120b|openai-compatible:groq:openai/gpt-oss-120b` (or `fallbacks:` in the file). Every route must name the same model (compared by the id after the last "/"), or the config is refused. An endpoint sets `structured_outputs: true` when its models accept `response_format: json_schema`; otherwise the schema is sent in the system prompt. Ollama always uses native structured outputs. An endpoint may list its free tier's daily token limits per model id as sent, `daily_token_limits: { "qwen/qwen3.8-27b": 200000 }` (input + output tokens a day). They are data for `aa usage` only; nothing is refused or throttled by them. The built-in `groq` preset lists the limits measured so far: 200k a day for `qwen/qwen3.8-27b` (it ran out on the 2026-10-19 nightly run) and for `openai/gpt-oss-120b` (Groq's own TPD 429s say "Limit 200000"); every other route shows "no known limit" until a config file adds it. A config file entry replaces the preset entry of the same name, except for its daily limits: the preset's `daily_token_limits` are kept under the file's own (the file wins per model), so overriding `groq` to change one setting keeps the measured limit.

A self-hosted OpenAI-compatible server (vLLM, LM Studio, llama.cpp server) is an endpoint added in the config file, with no `api_key_env` when the server needs no key. For example, the Kaggle notebook (`evals/kaggle/full-suite-vllm.ipynb`) writes:

```yaml
providers:
  openai-compatible:
    vllm: { base_url: "http://127.0.0.1:8000/v1", structured_outputs: true }
```

with `PLANNER_MODEL=EXTRACTOR_MODEL=JUDGE_MODEL=openai-compatible:vllm:Qwen3.8-27B-AWQ` (the server's `--served-model-name`). vLLM enforces `json_schema` with guided decoding, and tool calls need `--enable-auto-tool-choice` with the model's `--tool-call-parser`.

Model profiles (`packages/models/src/profiles.ts`) record per-model facts: context size, tool-calling reliability, JSON-mode support, and whether small-model mode applies. They are filled in from eval results.

## 5. Reliability

- **Structured output:** validated by Zod. On failure, retry up to 2 times with the validation error fed back. After that, the stage degrades gracefully (fewer findings) and logs it.
- **Timeouts:** 120s per call by default, longer for local CPU models (`MODEL_TIMEOUT_MS`, a whole number of milliseconds; anything else is a CONFIG error at startup).
- **Roles and providers** are checked at startup: planner, extractor and judge can't use `transformers`; the embedder is `transformers` or `ollama`; the reranker is `transformers`.
- **Usage:** tokens and latency are recorded per role in job events, so evals can report cost and speed.
- **Router** (M13a). Each route (provider + model) has a token bucket fed by the `x-ratelimit-remaining-*` and `x-ratelimit-reset-*` headers, and by 429s with their `retry-after`:
  - A call goes to the first route with capacity.
  - On a 429 before any of the call's requests succeeded, it moves to the next route of the **same model**. Mid tool-loop it waits instead, so tools are never re-run.
  - When every route is limited, it waits for the soonest, up to 90 s, then stops with `RATE_LIMITED`, naming each route and when it frees up.
  - It never switches models.
- **Output-token limit.** Some free tiers cap output tokens per minute and refuse a request whose possible output exceeds the cap ("Request too large … output tokens per minute (OTPM): Limit 1000"), as a 413 or, on Groq, sometimes as a 429. Waiting doesn't help, so the request is re-sent once per call, at once, with `max_tokens` at 95% of the stated limit; the refusal is logged as a failed call first. A 429 takes this path only when it refuses the request outright (it says "Request too large", or its Requested exceeds the Limit), before any rate-limit handling: it neither waits out its `retry-after` nor hands the call to the router, so the route isn't blocked. An OTPM rate limit ("Rate limit reached … Limit 1000, Used 800, Requested 300") is an ordinary 429, and so is a second refusal (M13h).
- **Input budget.** `generateObject` takes an optional `maxInputTokens`. Before anything is sent, the client estimates the request's input with `estimateObjectRequest`: the system prompt, the JSON Schema (counted even when it travels as `response_format`), the prompt, and the longest retry feedback. Over the budget, the call fails with `INPUT_TOO_LARGE` and nothing is sent; FakeModel applies the same check. With a budget, the retry feedback keeps only the validation issues (`path: message`, without the AI SDK's echo of the whole answer) and is cut to 300 characters, so retries fit too. Calls without a budget are sent exactly as before.
  - The estimate (`estimateTokens`) needs no tokenizer and no network: each digit and each non-ASCII character counts as one token, every other character as 1/3.2 of a token, plus 8 tokens per message. Qwen-style tokenizers split numbers into single digits, so a fact sheet runs near 3 characters per token.
  - It was calibrated on 97 real requests replayed from the eval cache (Groq qwen/qwen3.8-27b, gpt-oss-120b and gpt-oss-20b). It came out at 1.11–1.26× the provider's `prompt_tokens` and never below.
  - Small-model mode budgets DECIDE at 6,500 tokens (agent-and-verifier §8.1).
- **Two kinds of call.** A structured-output call carries no tools, and a tool loop asks for no structured output (enforced by a transport test).
- **Response cache.** Responses are keyed by SHA-256 of the URL and request body (model, messages, parameters); only successful responses are stored. Tools still run on replay, so cached runs give the same facts. It is on for `aa eval` (`evals/.cache/`), and on elsewhere with `AA_MODEL_CACHE=<dir>`. A cached answer is served even while every route is rate-limited: the router lets a call probe the cache before it waits or stops with `RATE_LIMITED` (on the routes it would wait for, or on every route when it is about to stop), and a miss sends nothing. A tool loop whose cached steps were served stays on that route: its next live step waits for the route (or stops), so tools never run twice (M13h).
- **Call log.** Every call reports role, provider, endpoint, model as sent, status, cached, latency and tokens. The CLI appends it to `data/logs/model-calls.jsonl` (stderr too with `AA_LOG_CALLS=1`), and eval results record calls per route. No prompt or answer text is logged. A failed call's provider error message is kept, short, with key-like strings, the configured key values and the provider's organization id (Groq's `org_` + 20 or more lowercase letters and digits → `org_***`) masked by `maskSecrets`; errors the client throws, `INVALID_OUTPUT` included, are masked the same way, since they end up in job status, failed-job reasons and eval results.
- **Token usage (M14a).** A call's `inputTokens` and `outputTokens` come from the provider's `usage` field (`prompt_tokens`, `completion_tokens`). A cached call records 0 for both: it spends no quota. A call whose response carries no usage (most failed calls) has no token fields: its spend is unknown, never 0, and `aa usage` and the eval results count such calls as "without a token count". A call is failed when its status is 0 (no response) or ≥ 400, the same rule in `aa usage` and in eval results (`failedCall`). Log lines written before M14a are read the same way, except that their cached calls still carry the cached answer's original usage, so a reader counts every `cached: true` line as 0 whatever it says (`spendOf`). Without `--day`, `aa usage` first shows each route's tokens logged over the **last 24 hours**, with the provider's own count when a rate-limit error in that window reported one ("Limit 200000, Used 198464"; `windowUsage`). Only the daily quota counts ("tokens per day (TPD)" in a 429; per-minute limits use the same words). The provider's count is shown as it was said, because neither a UTC day nor a plain 24-hour sum reproduces it: on 2026-10-21 at 10:46 UTC Groq reported 198,464 of 200,000 used, while that UTC day held 101,361 and the 24 hours before held 286,219 (all of which it had let through). No remainder is estimated. The `--json` output carries it as `window` (without `--day`). It then sums the log per UTC day (the log's `at` and the eval result dates use UTC), per role and per route, and shows each route's total (input + output) against its `daily_token_limits` entry (§4), or "no known limit". A route's limit is shown per route, not per role, since a provider's quota on a model counts every role it serves. Eval results record each route's tokens and the run's `usage` totals (docs/EVALS.md §3).

## 6. Testing

- `FakeModel` (`packages/models/testing`) returns scripted responses keyed by role and prompt hash (or substring). A response can be a function of the request, for scripts that must name ids only known at run time. Example: `packages/core/testing/coffee-planner.ts` reads fact and extract ids from the prompt, as a model would.
- All unit and integration tests use `FakeModel`. CI never needs a network model or a key.
- Real-model evals run on demand: `aa eval --model <profile>`.

## 7. Choosing models

The project doesn't depend on any one model. During development, use whatever free option is fastest. That's usually a free hosted endpoint for speed, or a small Ollama model for full privacy.

The officially supported model list and the default are decided at the end, from eval scores (docs/EVALS.md). Never decide it from launch headlines.
