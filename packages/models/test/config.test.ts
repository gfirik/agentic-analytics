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

  it("accepts a config file with extra endpoints and rejects unknown ones", () => {
    const file = {
      models: { planner: { provider: "openai-compatible", endpoint: "lmstudio", model: "qwen" } },
      providers: { "openai-compatible": { lmstudio: { base_url: "http://localhost:1234/v1" } } },
    };
    expect(resolveModelConfig({}, file).models.planner.endpoint).toBe("lmstudio");
    expect(() => resolveModelConfig({ JUDGE_MODEL: "openai-compatible:nowhere:m" })).toThrow(/unknown openai-compatible endpoint/);
  });
});
