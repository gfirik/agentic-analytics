// Resolves which provider and model serve each role (docs/specs/models.md §3–4).
// Sources, later wins: built-in defaults < config file < env (PLANNER_MODEL=ollama:qwen3.5:9b, …).
// Providers are always explicit; there is no fallback to the AI SDK's default gateway.
import { Config, type ConfigInput, type RoleModel } from "@agentic-analytics/schema";
import { ModelError } from "./errors.ts";

export type Env = Readonly<Record<string, string | undefined>>;

/** Free OpenAI-compatible endpoints (no credit card). A config file may add more or override these. */
export const OPENAI_COMPATIBLE_PRESETS: Readonly<Record<string, { base_url: string; api_key_env: string }>> = {
  groq: { base_url: "https://api.groq.com/openai/v1", api_key_env: "GROQ_API_KEY" },
  openrouter: { base_url: "https://openrouter.ai/api/v1", api_key_env: "OPENROUTER_API_KEY" },
  cerebras: { base_url: "https://api.cerebras.ai/v1", api_key_env: "CEREBRAS_API_KEY" },
  "github-models": { base_url: "https://models.github.ai/inference", api_key_env: "GITHUB_MODELS_TOKEN" },
};

export const DEFAULT_LOCAL_MODEL = "qwen3.5:9b";

const DEFAULTS: ConfigInput = {
  models: {
    planner: { provider: "ollama", model: DEFAULT_LOCAL_MODEL },
    extractor: { provider: "ollama", model: DEFAULT_LOCAL_MODEL },
    judge: { provider: "ollama", model: DEFAULT_LOCAL_MODEL },
    embedder: { provider: "transformers", model: "Xenova/bge-m3" },
  },
  providers: { ollama: { base_url: "http://localhost:11434" } },
};

const ROLE_ENV = { planner: "PLANNER_MODEL", extractor: "EXTRACTOR_MODEL", judge: "JUDGE_MODEL", embedder: "EMBEDDING_MODEL" } as const;

/** Parses `ollama:qwen3.5:9b`, `openai-compatible:groq:llama-3.3-70b-versatile` or `transformers:Xenova/bge-m3`. */
export function parseModelSpec(spec: string): RoleModel {
  const value = spec.trim().replace(/\s+#.*$/, "");
  const [provider, ...rest] = value.split(":");
  if (provider === "ollama" || provider === "transformers") {
    const model = rest.join(":");
    if (model) return { provider, model };
  } else if (provider === "openai-compatible") {
    const [endpoint, ...model] = rest;
    if (endpoint && model.length) return { provider, endpoint, model: model.join(":") };
  }
  throw new ModelError(
    "CONFIG",
    `invalid model spec "${spec}"; expected ollama:<model>, openai-compatible:<endpoint>:<model> or transformers:<model>`,
  );
}

export function resolveModelConfig(env: Env, file?: unknown): Config {
  const fromFile = (file ?? {}) as Partial<ConfigInput>;
  const models: Record<string, unknown> = { ...DEFAULTS.models, ...(fromFile.models ?? {}) };
  for (const [role, key] of Object.entries(ROLE_ENV)) {
    const spec = env[key];
    if (spec) models[role] = parseModelSpec(spec);
  }
  const ollamaUrl = env.OLLAMA_BASE_URL ?? fromFile.providers?.ollama?.base_url ?? DEFAULTS.providers?.ollama?.base_url;
  const timeout = env.MODEL_TIMEOUT_MS ? Number(env.MODEL_TIMEOUT_MS) : fromFile.timeouts?.model_ms;
  const parsed = Config.safeParse({
    ...fromFile,
    models,
    providers: {
      ...(fromFile.providers ?? {}),
      ...(ollamaUrl ? { ollama: { base_url: ollamaUrl } } : {}),
      "openai-compatible": { ...OPENAI_COMPATIBLE_PRESETS, ...(fromFile.providers?.["openai-compatible"] ?? {}) },
    },
    ...(timeout ? { timeouts: { model_ms: timeout } } : {}),
  });
  if (!parsed.success) {
    throw new ModelError(
      "CONFIG",
      `invalid model config: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  for (const [role, m] of Object.entries(parsed.data.models)) {
    if (m?.provider === "openai-compatible" && !parsed.data.providers["openai-compatible"]?.[m.endpoint ?? ""]) {
      throw new ModelError("CONFIG", `${role} uses unknown openai-compatible endpoint "${m.endpoint}"`);
    }
  }
  return parsed.data;
}

/** "ollama:qwen3.5:9b" style label for logs and doctor output. */
export function describeRoleModel(m: RoleModel): string {
  return m.provider === "openai-compatible" ? `openai-compatible:${m.endpoint}:${m.model}` : `${m.provider}:${m.model}`;
}
