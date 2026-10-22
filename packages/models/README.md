# @agentic-analytics/models

The model layer: one `ModelClient` interface over the Vercel AI SDK, free providers only, and `FakeModel` for tests.

- **Spec:** docs/specs/models.md
- **Status:** M1. Language models via `ollama` and `openai-compatible`; in-process embeddings live in `@agentic-analytics/retrieval` (`transformersEmbedder`) and are injected as `embed`.

## Public API

| Export | Does |
|---|---|
| `ModelClient` | `generateObject` (Zod-validated, retried with feedback), `generateWithTools` (fixed tools, step cap; a call the model got wrong — unknown tool, invalid input — is reported on that call as `error` and the loop goes on, while a tool that throws stops the call with its error, in both the real client and FakeModel), `embed` |
| `createModelClient(config, { env, fetch?, embed? })` | AI SDK implementation. The only place `ai` is imported. |
| `resolveModelConfig(env, file?)` | Defaults < config file < env (`PLANNER_MODEL=ollama:qwen3.5:9b`, `openai-compatible:groq:<model>`) |
| `OPENAI_COMPATIBLE_PRESETS` | Free endpoints: groq, openrouter, cerebras, nvidia-nim, google-ai-studio, sambanova, mistral, cloudflare (`${CLOUDFLARE_ACCOUNT_ID}` in its URL). github-models was removed (retired 2026-07-30) |
| `Router`, `routesOf` | Same-model routing across providers: token buckets from `x-ratelimit-*`, `retry-after`, fallback only to the same model, `RATE_LIMITED` when none is left. With `run(routes, call, { probeCache: true })` (set by the client when a response cache is configured) a limited route still serves cached answers |
| `fileCache(dir)`, `memoryCache()` | Response cache keyed by hash(URL, request body); `ProviderDeps.cache` |
| `CallRecord`, `ProviderDeps.onCall` | Every call with role, provider, model, status, cached, latency, tokens (from the provider's `usage`; 0 for a cached call; absent when unknown) |
| `parseCallLog(text)`, `dailyUsage(calls, { day?, limitOf? })`, `windowUsage(calls, { now, hours?, limitOf? })` (per route over the last 24 hours, with the provider's own `reported` count from a rate-limit error), `dailyTokenLimit(config, route)`, `spendOf`, `sumCalls`, `addCall`, `routeOf`, `dayOf` | Token usage from `data/logs/model-calls.jsonl` (models §5, "Token usage"): per UTC day, per role and per route, against the route's `daily_token_limits` (models §4; the `groq` preset has 200k a day for `qwen/qwen3.8-27b` and `openai/gpt-oss-120b`; a config file's `groq` entry replaces the preset entry but keeps its limits under the file's own). `failedCall`: status 0 or ≥ 400. A cached call counts 0 whatever its line says; a live call with no count is counted as unknown, not 0. What `aa usage` prints |
| `ModelError` | Typed errors: `CONFIG`, `MISSING_KEY`, `INVALID_OUTPUT`, `PROVIDER`, `TIMEOUT`, `INPUT_TOO_LARGE`, `RATE_LIMITED`, `INVALID_ARGUMENT`, `NOT_AVAILABLE`, `FAKE_NO_SCRIPT` |
| `estimateTokens(text)`, `estimateObjectRequest({ system, prompt, schema, maxRetries? })`, `checkInputBudget` | Conservative, offline input-token estimate: digits and non-ASCII characters count 1 each, other characters 1/3.2, plus 8 per message. It covers the system prompt, the schema, the prompt and the longest retry feedback. `GenerateObjectArgs.maxInputTokens` refuses an over-budget call with `INPUT_TOO_LARGE` before sending, in the real client and in FakeModel (models §5). |
| `boundedFeedback(error)`, `feedbackSuffix`, `FEEDBACK_MAX_CHARS` | Retry feedback for budgeted calls: the validation issues as `path: message`, at most 300 characters |
| `@agentic-analytics/models/testing` → `FakeModel`, `FakeRequest`, `promptHash` | Scripted responses by role and prompt substring/hash; runs scripted tool calls against the real tools; deterministic embeddings. An entry's `object` or `steps` may be a function of the `FakeRequest` (`{ role, system, prompt }`), for scripts that must name ids only known at run time (see `packages/core/testing/coffee-planner.ts`) |

## Example

```ts
import { FakeModel } from "@agentic-analytics/models/testing";
const model = new FakeModel([{ role: "extractor", match: "revenue", object: { metric: "revenue" } }]);
const { object } = await model.generateObject({ role: "extractor", schema, system: "…", prompt: "Which column is revenue?" });
```

Tests never call a network model; the AI SDK path is tested against a stub `fetch` that speaks the OpenAI format.

## Provider HTTP layer

`providerFetch(fetch, { timeoutMs, maxRetries, maxWaitMs })` sits under both OpenAI-compatible providers (found by running against Groq in M11):

- It drops `reasoning_content` from the messages it sends back. A tool loop otherwise echoes the model's reasoning, and some endpoints refuse that.
- It retries an HTTP 429 after the wait the endpoint asks for (`Retry-After`, or "try again in 24.7s"), up to 4 times and 90 s per wait.
- It retries an "output tokens per minute" (OTPM) refusal once, at once, with `max_tokens` at 95% of the stated limit. That is a 413, or a 429 that refuses the request outright ("Request too large", or Requested over the Limit; Groq sends both), and it happens once per call, even after an ordinary 429's wait. Such a 429 is not waited out and not handed to the router; an OTPM rate limit ("Rate limit reached … Used 800, Requested 300") is. The refusal is logged as a failed call before the re-send. That one re-send is on top of the 429 retries, so a call makes at most 6 requests.
- The model timeout applies to each HTTP request, so rate-limit waits don't count against it. A whole call is bounded at 20× the timeout.

**Key masking limits.** `maskSecrets` masks the configured key values (8 characters or more), key-like prefixes and the provider's organization id in Groq's form (`org_` + 20 or more lowercase letters and digits → `org_***`). It is applied to call records and to every error the client throws, `INVALID_OUTPUT` included. Other org id forms (`org-…`, uppercase, or shorter ids) are not masked, so that identifiers like `org_name` stay readable. A shorter key, or an unprefixed credential that isn't a configured key (an `x-api-key` header value, Basic auth), is not masked if a provider echoes it.
