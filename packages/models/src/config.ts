// Resolves which provider and model serve each role (docs/specs/models.md §3–4).
// Sources, later wins: built-in defaults < config file < env (PLANNER_MODEL=ollama:qwen3.5:9b, …).
// Providers are always explicit; there is no fallback to the AI SDK's default gateway.
import { Config, type ConfigInput, type RoleModel } from "@agentic-analytics/schema";
import { ModelError } from "./errors.ts";

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * Free OpenAI-compatible endpoints (free tiers, no credit card). A config file may add more or override these.
 * `${VAR}` in a base URL is filled from the environment (Cloudflare's account id). GitHub Models was removed:
 * the service was retired on 2026-07-30. `daily_token_limits` lists only the limits we have measured (models.md §4):
 * Groq's 200k tokens a day for qwen/qwen3.8-27b ran out on the 2026-10-19 nightly run. `aa usage` shows "no known
 * limit" for every other route; a config file may add them.
 */
export const OPENAI_COMPATIBLE_PRESETS: Readonly<
  Record<string, { base_url: string; api_key_env: string; daily_token_limits?: Readonly<Record<string, number>> }>
> = {
  groq: {
    base_url: "https://api.groq.com/openai/v1",
    api_key_env: "GROQ_API_KEY",
    // Both measured from Groq's own TPD 429s ("Limit 200000"): 2026-10-17 to 2026-10-21.
    daily_token_limits: { "qwen/qwen3.8-27b": 200_000, "openai/gpt-oss-120b": 200_000 },
  },
  openrouter: { base_url: "https://openrouter.ai/api/v1", api_key_env: "OPENROUTER_API_KEY" },
  cerebras: { base_url: "https://api.cerebras.ai/v1", api_key_env: "CEREBRAS_API_KEY" },
  "nvidia-nim": { base_url: "https://integrate.api.nvidia.com/v1", api_key_env: "NVIDIA_API_KEY" },
  "google-ai-studio": { base_url: "https://generativelanguage.googleapis.com/v1beta/openai", api_key_env: "GEMINI_API_KEY" },
  sambanova: { base_url: "https://api.sambanova.ai/v1", api_key_env: "SAMBANOVA_API_KEY" },
  mistral: { base_url: "https://api.mistral.ai/v1", api_key_env: "MISTRAL_API_KEY" },
  cloudflare: {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a ${VAR} placeholder filled by expandUrl, not a JS template
    base_url: "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    api_key_env: "CLOUDFLARE_API_TOKEN",
  },
};

/**
 * Fills `${VAR}` in a base URL from the environment; a missing variable stays visible so the error names it. Only
 * account-style variables (`*_ACCOUNT_ID`) are filled: a URL is printed and probed by `aa doctor`, so it must never
 * be able to pull in a key.
 */
export function expandUrl(url: string, env: Env): string {
  return url.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (m, name: string) => (/_ACCOUNT_ID$/.test(name) ? (env[name] ?? m) : m));
}

/**
 * The model a route serves, independent of how a provider spells it: the id after the last "/", lower-cased,
 * without a ":free"-style tag (`openai/gpt-oss-120b` on Groq and `gpt-oss-120b` on Cerebras are the same model).
 */
export function canonicalModel(model: string): string {
  return (model.split("/").pop() ?? model).toLowerCase().replace(/:(free|latest)$/, "");
}

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

/**
 * Parses `ollama:qwen3.5:9b`, `openai-compatible:groq:llama-3.3-70b-versatile` or `transformers:Xenova/bge-m3`.
 * Routes for the same model on several providers are separated by `|`; the first is preferred.
 */
export function parseModelSpec(spec: string): RoleModel {
  const routes = spec
    .trim()
    .replace(/\s+#.*$/, "")
    .split("|")
    .map((r) => r.trim())
    .filter(Boolean);
  const [first, ...rest] = routes.map(parseRoute);
  if (!first) throw new ModelError("CONFIG", `invalid model spec "${spec}"`);
  return rest.length ? { ...first, fallbacks: rest } : first;
}

function parseRoute(spec: string): RoleModel {
  const value = spec;
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

/**
 * The presets with the config file's endpoints over them. A file entry replaces the preset entry of the same name,
 * except its daily token limits: the preset's are kept under the file's own (the file wins per model), so
 * overriding `groq` to change one setting doesn't lose the measured 200k limit (models §4).
 */
function withPresets(file: unknown): Record<string, unknown> {
  const own = typeof file === "object" && file !== null ? (file as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...OPENAI_COMPATIBLE_PRESETS, ...own };
  for (const [name, preset] of Object.entries(OPENAI_COMPATIBLE_PRESETS)) {
    const entry = own[name];
    if (!preset.daily_token_limits || typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const limits = typeof e.daily_token_limits === "object" && e.daily_token_limits !== null ? e.daily_token_limits : {};
    out[name] = { ...e, daily_token_limits: { ...preset.daily_token_limits, ...limits } };
  }
  return out;
}

export function resolveModelConfig(env: Env, file?: unknown): Config {
  const fromFile = (file ?? {}) as Partial<ConfigInput>;
  const models: Record<string, unknown> = { ...DEFAULTS.models, ...(fromFile.models ?? {}) };
  for (const [role, key] of Object.entries(ROLE_ENV)) {
    const spec = env[key];
    if (spec) models[role] = parseModelSpec(spec);
  }
  const ollamaUrl = env.OLLAMA_BASE_URL ?? fromFile.providers?.ollama?.base_url ?? DEFAULTS.providers?.ollama?.base_url;
  // A mistyped MODEL_TIMEOUT_MS ("2m", "abc", "0") is an error that names the variable, not a silent default.
  const rawTimeout = env.MODEL_TIMEOUT_MS?.trim();
  if (rawTimeout && !(/^\d+$/.test(rawTimeout) && Number(rawTimeout) > 0))
    throw new ModelError("CONFIG", `MODEL_TIMEOUT_MS must be a whole number of milliseconds above 0, not "${rawTimeout}"`);
  const timeout = rawTimeout ? Number(rawTimeout) : fromFile.timeouts?.model_ms;
  const parsed = Config.safeParse({
    ...fromFile,
    models,
    providers: {
      ...(fromFile.providers ?? {}),
      ...(ollamaUrl ? { ollama: { base_url: ollamaUrl } } : {}),
      "openai-compatible": withPresets(fromFile.providers?.["openai-compatible"]),
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
    if (!m) continue;
    for (const r of [m, ...(m.fallbacks ?? [])]) {
      // In-process transformers serve embeddings only, and embeddings come from transformers or Ollama: caught here,
      // not at the first model call deep inside a job.
      if (["planner", "extractor", "judge"].includes(role) && r.provider === "transformers")
        throw new ModelError(
          "CONFIG",
          `${role} can't use transformers (it serves embeddings and reranking only); use ollama or openai-compatible`,
        );
      if (role === "embedder" && r.provider !== "transformers" && r.provider !== "ollama")
        throw new ModelError("CONFIG", `embedder must be transformers or ollama, not ${r.provider}`);
      if (role === "reranker" && r.provider !== "transformers")
        throw new ModelError("CONFIG", `reranker must be transformers (an in-process ONNX model), not ${r.provider}`);
      if (r.provider === "openai-compatible" && !parsed.data.providers["openai-compatible"]?.[r.endpoint ?? ""]) {
        throw new ModelError("CONFIG", `${role} uses unknown openai-compatible endpoint "${r.endpoint}"`);
      }
      // The router only ever falls back to the same model: a route that names another model is a config error.
      if (canonicalModel(r.model) !== canonicalModel(m.model)) {
        throw new ModelError(
          "CONFIG",
          `${role}: fallback ${describeRoleModel(r)} serves "${canonicalModel(r.model)}", not "${canonicalModel(m.model)}"; every route of a role must be the same model`,
        );
      }
    }
  }
  const compatible = parsed.data.providers["openai-compatible"] ?? {};
  for (const e of Object.values(compatible)) e.base_url = expandUrl(e.base_url, env);
  return parsed.data;
}

/** "ollama:qwen3.5:9b" style label for logs and doctor output. */
export function describeRoleModel(m: { provider: string; endpoint?: string | undefined; model: string }): string {
  return m.provider === "openai-compatible" ? `openai-compatible:${m.endpoint}:${m.model}` : `${m.provider}:${m.model}`;
}
