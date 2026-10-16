// ModelClient over the Vercel AI SDK (DECISIONS D4). This is the only file in the repo that imports `ai`
// (AGENTS.md §3). Both free providers go through the OpenAI-compatible protocol: Ollama exposes it at
// `<base>/v1`, and Groq/OpenRouter/Cerebras/… are OpenAI-compatible by definition.

import type { Config, RoleModel } from "@agentic-analytics/schema";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type LanguageModel, NoObjectGeneratedError, Output, stepCountIs, tool } from "ai";
import type { Env } from "./config.ts";
import { ModelError } from "./errors.ts";
import { generateValidated } from "./retry.ts";
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
  /** Overrides the embedder (in-process transformers lands in M6). */
  readonly embed?: (texts: readonly string[]) => Promise<number[][]>;
}

export function languageModel(m: RoleModel, config: Config, deps: ProviderDeps): LanguageModel {
  const common = deps.fetch ? { fetch: deps.fetch } : {};
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
  const model = (role: Role) => languageModel(config.models[role], config, deps);
  const usageOf = (u: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined, latencyMs: number): Usage => ({
    inputTokens: u?.inputTokens ?? 0,
    outputTokens: u?.outputTokens ?? 0,
    latencyMs,
  });

  return {
    async generateObject<T>(args: GenerateObjectArgs<T>) {
      const lm = model(args.role);
      const { object, usage } = await generateValidated(
        args.schema,
        args.prompt,
        async (prompt) => {
          const started = performance.now();
          try {
            const res = await generateText({
              model: lm,
              system: args.system,
              prompt,
              output: Output.object({ schema: args.schema }),
              maxRetries: 0,
              abortSignal: AbortSignal.timeout(timeoutMs),
            });
            return { value: res.output as unknown, usage: usageOf(res.usage, performance.now() - started) };
          } catch (err) {
            if (NoObjectGeneratedError.isInstance(err)) {
              return {
                invalid: err.cause instanceof Error ? err.cause.message : err.message,
                usage: usageOf(err.usage, performance.now() - started),
              };
            }
            throw providerError(err);
          }
        },
        args.maxRetries,
      );
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
        const res = await generateText({
          model: model(args.role),
          system: args.system,
          messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
          tools,
          stopWhen: stepCountIs(args.maxSteps),
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(timeoutMs),
        });
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
      throw new ModelError("NOT_AVAILABLE", "in-process embeddings (transformers) land in M6; inject `embed` until then");
    },
  };
}

function providerError(err: unknown): ModelError {
  if (err instanceof ModelError) return err;
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  return new ModelError(name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "PROVIDER", message, { cause: err });
}
