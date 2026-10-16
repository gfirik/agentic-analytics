// `agentic-analytics.config.yaml` (docs/specs/models.md §4). Every provider is configured explicitly:
// there is no implicit default gateway. Paid providers are not accepted before M13 (DECISIONS D5).
import { z } from "zod";

export const ProviderId = z.enum(["ollama", "openai-compatible", "transformers"]);

export const RoleModel = z
  .object({
    provider: ProviderId,
    /** Name of an entry under `providers.openai-compatible` (required for that provider). */
    endpoint: z.string().optional(),
    model: z.string().min(1),
  })
  .refine((r) => r.provider !== "openai-compatible" || !!r.endpoint, {
    message: "openai-compatible models need `endpoint` naming an entry under providers.openai-compatible",
    path: ["endpoint"],
  });

export const OpenAICompatibleEndpoint = z.object({
  base_url: z.url(),
  /** Name of the env var holding the key. Keys never live in the config file. */
  api_key_env: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .optional(),
});

export const Config = z.object({
  models: z.object({
    planner: RoleModel,
    extractor: RoleModel,
    judge: RoleModel,
    embedder: RoleModel,
    reranker: RoleModel.optional(),
  }),
  providers: z
    .object({
      ollama: z.object({ base_url: z.url() }).optional(),
      "openai-compatible": z.record(z.string(), OpenAICompatibleEndpoint).optional(),
    })
    .default({}),
  timeouts: z.object({ model_ms: z.number().int().positive().default(120_000) }).default({ model_ms: 120_000 }),
  web: z
    .object({ enabled: z.boolean().default(false), provider: z.literal("searxng").default("searxng"), base_url: z.url().optional() })
    .default({ enabled: false, provider: "searxng" }),
  docling: z.object({ base_url: z.url() }).optional(),
  data_dir: z.string().default("./data"),
});

export type RoleModel = z.infer<typeof RoleModel>;
export type Config = z.infer<typeof Config>;
export type ConfigInput = z.input<typeof Config>;
