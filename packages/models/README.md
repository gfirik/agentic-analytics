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
