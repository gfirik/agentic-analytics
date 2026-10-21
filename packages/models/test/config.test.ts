import { describe, expect, it } from "vitest";
import { describeRoleModel, parseModelSpec, resolveModelConfig } from "../src/index.ts";

describe("model config", () => {
  it("parses model specs", () => {
    expect(parseModelSpec("ollama:qwen3.5:9b")).toEqual({ provider: "ollama", model: "qwen3.5:9b" });
    expect(parseModelSpec("openai-compatible:groq:llama-3.3-70b-versatile")).toEqual({
      provider: "openai-compatible",
      endpoint: "groq",
      model: "llama-3.3-70b-versatile",
    });
    expect(parseModelSpec("transformers:Xenova/bge-m3   # in-process, no install")).toEqual({
      provider: "transformers",
      model: "Xenova/bge-m3",
    });
    expect(() => parseModelSpec("anthropic:claude")).toThrow(/invalid model spec/);
  });

  it("defaults to local Ollama and in-process embeddings", () => {
    const c = resolveModelConfig({});
    expect(describeRoleModel(c.models.planner)).toBe("ollama:qwen3.5:9b");
    expect(c.models.embedder.provider).toBe("transformers");
    expect(c.providers.ollama?.base_url).toBe("http://localhost:11434");
  });

  it("lets env override roles, the Ollama URL and the timeout", () => {
    const c = resolveModelConfig({
      PLANNER_MODEL: "openai-compatible:groq:llama-3.3-70b",
      OLLAMA_BASE_URL: "http://gpu:11434",
      MODEL_TIMEOUT_MS: "300000",
    });
    expect(c.models.planner).toEqual({ provider: "openai-compatible", endpoint: "groq", model: "llama-3.3-70b" });
    expect(c.providers.ollama?.base_url).toBe("http://gpu:11434");
    expect(c.timeouts.model_ms).toBe(300_000);
    expect(c.providers["openai-compatible"]?.groq?.api_key_env).toBe("GROQ_API_KEY");
  });

  it("accepts Cloudflare Workers AI as a second route for Groq's qwen3.8-27b, and refuses Cerebras's differently spelled id", () => {
    // The nightly eval's planner (docs/EVALS.md §4): Cloudflare serves the same model as @cf/qwen/qwen3.8-27b.
    const c = resolveModelConfig({
      PLANNER_MODEL: "openai-compatible:groq:qwen/qwen3.8-27b|openai-compatible:cloudflare:@cf/qwen/qwen3.8-27b",
      CLOUDFLARE_ACCOUNT_ID: "acc",
    });
    expect(c.models.planner.fallbacks).toEqual([{ provider: "openai-compatible", endpoint: "cloudflare", model: "@cf/qwen/qwen3.8-27b" }]);
    // Cerebras names it qwen-3.8-27b; the router compares ids, so it is not accepted as the same model.
    expect(() =>
      resolveModelConfig({ PLANNER_MODEL: "openai-compatible:groq:qwen/qwen3.8-27b|openai-compatible:cerebras:qwen-3.8-27b" }),
    ).toThrow(/every route of a role must be the same model/);
  });

  it("accepts a config file with extra endpoints and rejects unknown ones", () => {
    const file = {
      models: { planner: { provider: "openai-compatible", endpoint: "lmstudio", model: "qwen" } },
      providers: { "openai-compatible": { lmstudio: { base_url: "http://localhost:1234/v1" } } },
    };
    expect(resolveModelConfig({}, file).models.planner.endpoint).toBe("lmstudio");
    expect(() => resolveModelConfig({ JUDGE_MODEL: "openai-compatible:nowhere:m" })).toThrow(/unknown openai-compatible endpoint/);
  });
});

describe("config mistakes are named at startup (code-quality fix 11)", () => {
  it("a mistyped MODEL_TIMEOUT_MS is a CONFIG error naming the variable, not a silent default", () => {
    for (const v of ["2m", "abc", "0", "-5", "1.5"])
      expect(() => resolveModelConfig({ MODEL_TIMEOUT_MS: v }), v).toThrowError(
        expect.objectContaining({ code: "CONFIG", message: expect.stringContaining("MODEL_TIMEOUT_MS") }),
      );
    expect(resolveModelConfig({ MODEL_TIMEOUT_MS: "90000" }).timeouts.model_ms).toBe(90000);
  });

  it("transformers serves embeddings only, and embeddings come from transformers or Ollama", () => {
    expect(() => resolveModelConfig({ PLANNER_MODEL: "transformers:Xenova/bge-m3" })).toThrowError(
      expect.objectContaining({ code: "CONFIG", message: expect.stringContaining("planner can't use transformers") }),
    );
    expect(() => resolveModelConfig({ EMBEDDING_MODEL: "openai-compatible:groq:some-embedder" })).toThrowError(
      expect.objectContaining({ code: "CONFIG", message: expect.stringContaining("embedder must be transformers or ollama") }),
    );
    expect(resolveModelConfig({ EMBEDDING_MODEL: "ollama:bge-m3" }).models.embedder?.provider).toBe("ollama");
    // A transformers reranker is the documented default (models.md, retrieval.md).
    const withReranker = resolveModelConfig(
      {},
      { models: { reranker: { provider: "transformers", model: "onnx-community/bge-reranker-v2-m3-ONNX" } } },
    );
    expect(withReranker.models.reranker?.provider).toBe("transformers");
    expect(() => resolveModelConfig({}, { models: { reranker: { provider: "ollama", model: "bge-reranker" } } })).toThrowError(
      expect.objectContaining({ code: "CONFIG", message: expect.stringContaining("reranker must be transformers") }),
    );
  });
});
