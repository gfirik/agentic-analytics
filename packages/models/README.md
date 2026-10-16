# @agentic-analytics/models

The model layer: one `ModelClient` interface over the Vercel AI SDK, free providers only, and `FakeModel` for tests.

- **Spec:** docs/specs/models.md
- **Status:** M1. Language models via `ollama` and `openai-compatible`; in-process embeddings live in `@agentic-analytics/retrieval` (`transformersEmbedder`) and are injected as `embed`.

## Public API

| Export | Does |
|---|---|
| `ModelClient` | `generateObject` (Zod-validated, retried with feedback), `generateWithTools` (fixed tools, step cap), `embed` |
| `createModelClient(config, { env, fetch?, embed? })` | AI SDK implementation. The only place `ai` is imported. |
| `resolveModelConfig(env, file?)` | Defaults < config file < env (`PLANNER_MODEL=ollama:qwen3.5:9b`, `openai-compatible:groq:<model>`) |
| `OPENAI_COMPATIBLE_PRESETS` | Free endpoints: groq, openrouter, cerebras, github-models |
| `ModelError` | Typed errors: `CONFIG`, `MISSING_KEY`, `INVALID_OUTPUT`, `PROVIDER`, `TIMEOUT`, `NOT_AVAILABLE`, `FAKE_NO_SCRIPT` |
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
- The model timeout applies to each HTTP request, so rate-limit waits don't count against it. A whole call is bounded at 20× the timeout.
