// ModelClient over the Vercel AI SDK (DECISIONS D4). This is the only file in the repo that imports `ai`
// (AGENTS.md §3). Both free providers go through the OpenAI-compatible protocol: Ollama exposes it at
// `<base>/v1`, and Groq/OpenRouter/Cerebras/… are OpenAI-compatible by definition.

import type { Config, RoleModel, RouteModel } from "@agentic-analytics/schema";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, generateText, type LanguageModel, NoObjectGeneratedError, Output, stepCountIs, tool } from "ai";
import { checkInputBudget, schemaInstruction } from "./budget.ts";
import type { ResponseCache } from "./cache.ts";
import type { Env } from "./config.ts";
import { ModelError } from "./errors.ts";
import { type CallRecord, maskSecrets, providerFetch } from "./fetch.ts";
import { generateValidated } from "./retry.ts";
import { type RouteLease, Router } from "./router.ts";
import {
  addUsage,
  type GenerateObjectArgs,
  type GenerateWithToolsArgs,
  type ModelClient,
  type Role,
  type Step,
  type ToolCallRecord,
  type Usage,
  ZERO_USAGE,
} from "./types.ts";

export interface ProviderDeps {
  readonly env: Env;
  /** Injected for tests; defaults to the global fetch. Never the AI SDK gateway. */
  readonly fetch?: typeof fetch;
  /** The embedder, e.g. `transformersEmbedder().embed` from @agentic-analytics/retrieval. */
  readonly embed?: (texts: readonly string[]) => Promise<number[][]>;
  /** Routes calls across the providers of one model; a fresh router per client by default. */
  readonly router?: Router;
  /** Serves repeated requests from disk (evals); off by default. */
  readonly cache?: ResponseCache;
  /** Every call with the provider and model that served it. */
  readonly onCall?: (c: CallRecord) => void;
}

/** Every route of a role: the configured model first, then its fallbacks (the same model elsewhere). */
export const routesOf = (m: RoleModel): RouteModel[] => [
  { provider: m.provider, ...(m.endpoint ? { endpoint: m.endpoint } : {}), model: m.model },
  ...(m.fallbacks ?? []),
];

/** Whether the role's endpoint enforces a JSON Schema natively. Ollama's /v1 does; other endpoints opt in. */
export function supportsStructuredOutputs(m: RouteModel, config: Config): boolean {
  if (m.provider === "ollama") return true;
  if (m.provider === "openai-compatible") return config.providers["openai-compatible"]?.[m.endpoint ?? ""]?.structured_outputs ?? false;
  return false;
}

export function languageModel(
  m: RouteModel,
  config: Config,
  deps: ProviderDeps,
  call: { lease?: RouteLease; role?: string } = {},
): LanguageModel {
  const common = {
    supportsStructuredOutputs: supportsStructuredOutputs(m, config),
    fetch: providerFetch(deps.fetch ?? fetch, {
      timeoutMs: config.timeouts.model_ms,
      ...(call.lease ? { lease: call.lease } : {}),
      ...(deps.cache ? { cache: deps.cache } : {}),
      ...(deps.onCall ? { onCall: deps.onCall } : {}),
      secrets: secretsOf(config, deps.env),
      label: { ...(call.role ? { role: call.role } : {}), provider: m.provider, ...(m.endpoint ? { endpoint: m.endpoint } : {}) },
    }),
  };
  if (m.provider === "ollama") {
    const base = config.providers.ollama?.base_url;
    if (!base) throw new ModelError("CONFIG", "ollama is used but providers.ollama.base_url is not set");
    return createOpenAICompatible({ name: "ollama", baseURL: `${base.replace(/\/+$/, "")}/v1`, includeUsage: true, ...common }).chatModel(
      m.model,
    );
  }
  if (m.provider === "openai-compatible") {
    const endpoint = config.providers["openai-compatible"]?.[m.endpoint ?? ""];
    if (!endpoint) throw new ModelError("CONFIG", `unknown openai-compatible endpoint "${m.endpoint}"`);
    const apiKey = endpoint.api_key_env ? deps.env[endpoint.api_key_env] : undefined;
    if (endpoint.api_key_env && !apiKey)
      throw new ModelError("MISSING_KEY", `${endpoint.api_key_env} is not set (needed for ${m.endpoint})`);
    return createOpenAICompatible({
      name: m.endpoint ?? "openai-compatible",
      baseURL: endpoint.base_url,
      includeUsage: true,
      ...(apiKey ? { apiKey } : {}),
      ...common,
    }).chatModel(m.model);
  }
  throw new ModelError("CONFIG", `provider "${m.provider}" can't serve a language-model role`);
}

export function createModelClient(config: Config, deps: ProviderDeps): ModelClient {
  const timeoutMs = config.timeouts.model_ms;
  // The configured keys, masked in any error message this client throws (it ends up in status.json, SSE and chats).
  const secrets = secretsOf(config, deps.env);
  const providerError = (err: unknown) => toProviderError(err, secrets);
  // The longest a call may take: each request's timeout, plus the most rate-limit waiting providerFetch allows
  // (4 waits of at most 90 s) per request.
  const callCap = (requests: number) => requests * (timeoutMs + 4 * 90_000);
  const router = deps.router ?? new Router();
  /** Runs one call on a route of the role's model, chosen by the router (same model, any of its providers). */
  const onRoute = <T>(role: Role, f: (lm: LanguageModel, route: RouteModel) => Promise<T>) =>
    router.run(routesOf(config.models[role]), (lease) => f(languageModel(lease.route, config, deps, { lease, role }), lease.route), {
      probeCache: !!deps.cache,
    });
  const usageOf = (u: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined, latencyMs: number): Usage => ({
    inputTokens: u?.inputTokens ?? 0,
    outputTokens: u?.outputTokens ?? 0,
    latencyMs,
  });

  return {
    async generateObject<T>(args: GenerateObjectArgs<T>) {
      // A structured-output call never carries tools; a tool loop never asks for structured output (M13a: two
      // separate calls, enforced in ai-sdk.test.ts).
      checkInputBudget(args);
      const { object, usage } = await generateValidated(
        args.schema,
        args.prompt,
        async (prompt) => {
          const started = performance.now();
          try {
            return await onRoute(args.role, async (lm, route) => {
              // Without native structured outputs the endpoint only gets json_object mode, so the schema goes in the prompt.
              const system = supportsStructuredOutputs(route, config) ? args.system : `${args.system}${schemaInstruction(args.schema)}`;
              try {
                const res = await generateText({
                  model: lm,
                  system,
                  prompt,
                  output: Output.object({ schema: args.schema }),
                  maxRetries: 0,
                  // One request with its own timeout (providerFetch); this bounds the call, rate-limit waits included.
                  abortSignal: AbortSignal.timeout(callCap(1)),
                });
                return { value: res.output as unknown, usage: usageOf(res.usage, performance.now() - started) };
              } catch (err) {
                // An endpoint that validates JSON itself (Groq: 400 `json_validate_failed`) refuses malformed output
                // with an error; that is an invalid attempt to retry with feedback, not a provider failure.
                if (
                  APICallError.isInstance(err) &&
                  err.statusCode === 400 &&
                  /json_validate_failed|failed to validate json/i.test(`${err.message} ${err.responseBody ?? ""}`)
                ) {
                  return {
                    invalid: "the JSON did not validate against the schema",
                    usage: usageOf(undefined, performance.now() - started),
                  };
                }
                if (NoObjectGeneratedError.isInstance(err)) {
                  return {
                    invalid: err.cause instanceof Error ? err.cause.message : err.message,
                    usage: usageOf(err.usage, performance.now() - started),
                  };
                }
                throw err;
              }
            });
          } catch (err) {
            throw providerError(err);
          }
        },
        args.maxRetries,
        { boundedFeedback: args.maxInputTokens !== undefined },
      ).catch((err: unknown) => {
        // INVALID_OUTPUT quotes the last validation error, which can quote the endpoint's own text; masked like the rest.
        throw providerError(err);
      });
      return { object, usage };
    },

    async generateWithTools(args: GenerateWithToolsArgs) {
      const tools = Object.fromEntries(
        Object.entries(args.tools).map(([name, t]) => [
          name,
          tool({ description: t.description, inputSchema: t.inputSchema, execute: async (input: unknown) => t.execute(input) }),
        ]),
      );
      const started = performance.now();
      try {
        const res = await onRoute(args.role, (lm) =>
          generateText({
            model: lm,
            system: args.system,
            messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
            tools,
            stopWhen: stepCountIs(args.maxSteps),
            maxRetries: 0,
            // Each step is one request with its own timeout (providerFetch); this bounds the loop, waits included.
            abortSignal: AbortSignal.timeout(callCap(args.maxSteps)),
          }),
        );
        const steps: Step[] = res.steps.map((s) => ({
          text: s.text,
          toolCalls: s.toolCalls.map((c): ToolCallRecord => {
            const result = s.toolResults.find((r) => r.toolCallId === c.toolCallId);
            return { toolName: c.toolName, input: c.input, ...(result ? { output: result.output } : {}) };
          }),
          usage: usageOf(s.usage, 0),
        }));
        const usage = steps.reduce((acc, s) => addUsage(acc, s.usage), ZERO_USAGE);
        return { steps, usage: { ...usage, latencyMs: performance.now() - started } };
      } catch (err) {
        throw providerError(err);
      }
    },

    async embed(texts) {
      if (deps.embed) return deps.embed(texts);
      // In-process embeddings live in @agentic-analytics/retrieval (transformersEmbedder), which the pipeline
      // injects here; models stays free of the ONNX runtime.
      throw new ModelError("NOT_AVAILABLE", "no embedder injected: pass `embed` (e.g. retrieval's transformersEmbedder)");
    },
  };
}

/** The configured API key values, masked in every error message and log line this package produces. */
function secretsOf(config: Config, env: Env): string[] {
  return Object.values(config.providers["openai-compatible"] ?? {}).flatMap((e) => {
    const v = e.api_key_env ? env[e.api_key_env] : undefined;
    return v ? [v] : [];
  });
}

/**
 * A provider failure as a ModelError whose message and cause chain are masked: callers print `cause.message` too
 * (doctor), so the original error is not attached as is.
 */
function toProviderError(err: unknown, secrets: readonly string[]): ModelError {
  const masked = (e: unknown, depth = 0): Error | undefined => {
    if (!(e instanceof Error) || depth > 4) return undefined;
    const copy = new Error(maskSecrets(e.message, secrets), { cause: masked(e.cause, depth + 1) });
    copy.name = e.name;
    return copy;
  };
  if (err instanceof ModelError) {
    const cause = masked(err.cause);
    return new ModelError(err.code, maskSecrets(err.message, secrets), cause ? { cause } : undefined);
  }
  const name = err instanceof Error ? err.name : "";
  const message = maskSecrets(err instanceof Error ? err.message : String(err), secrets);
  const cause = masked(err instanceof Error ? err.cause : undefined);
  return new ModelError(name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "PROVIDER", message, cause ? { cause } : undefined);
}
