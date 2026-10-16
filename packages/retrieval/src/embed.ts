// Embedders (retrieval spec §2). The default runs an ONNX model in-process through @huggingface/transformers:
// no install, no Ollama, the model downloads once into the local cache. `hashEmbedder` needs nothing at all;
// tests use it, and it is the offline fallback when no model can be downloaded.
import type { Embedder } from "./types.ts";
import { RetrievalError } from "./types.ts";

// ── hashEmbedder ────────────────────────────────────────────────────────────────────────────────────────────

/** FNV-1a 32-bit: a fixed, platform-independent hash for feature hashing. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const WORD = /[\p{L}\p{N}]+/gu;

/**
 * Feature-hashed bag of words and character 3–5-grams, L2-normalized. The n-grams match inflected forms
 * ("shipments"/"shipment", "печати"/"печать") without a stemmer, so it works for any language. It is a lexical
 * model: it does not know synonyms, which is what the real embedding model adds.
 */
export function hashEmbedder(dims = 1024): Embedder {
  const vec = (text: string): number[] => {
    const v = new Array<number>(dims).fill(0);
    const add = (feature: string, weight: number) => {
      const h = fnv1a(feature);
      v[h % dims] = (v[h % dims] ?? 0) + ((h >>> 31) & 1 ? -weight : weight);
    };
    for (const m of text.toLowerCase().matchAll(WORD)) {
      const w = m[0];
      add(`w:${w}`, 1);
      const padded = `<${w}>`;
      for (let n = 3; n <= 5; n++) for (let i = 0; i + n <= padded.length; i++) add(`g:${padded.slice(i, i + n)}`, 0.5);
    }
    const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
    return norm ? v.map((x) => x / norm) : v;
  };
  return {
    id: `hash-ngram-${dims}`,
    embed: async (texts) => texts.map(vec),
  };
}

// ── transformersEmbedder ───────────────────────────────────────────────────────────────────────────────────

interface ModelProfile {
  readonly pooling: "mean" | "cls";
  readonly query: string;
  readonly passage: string;
}

/** Pooling and instruction prefixes the model was trained with; unknown models get mean pooling, no prefix. */
const PROFILES: Record<string, ModelProfile> = {
  "Xenova/bge-m3": { pooling: "cls", query: "", passage: "" },
  "Xenova/multilingual-e5-small": { pooling: "mean", query: "query: ", passage: "passage: " },
  "Xenova/multilingual-e5-base": { pooling: "mean", query: "query: ", passage: "passage: " },
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2": { pooling: "mean", query: "", passage: "" },
};

export const DEFAULT_EMBEDDING_MODEL = "Xenova/bge-m3";

export interface TransformersOptions {
  readonly model?: string;
  /** Quantization of the ONNX weights; q8 keeps bge-m3 at ~570 MB and fast enough on CPU. */
  readonly dtype?: "fp32" | "fp16" | "q8" | "q4";
  /** Texts per forward pass. */
  readonly batchSize?: number;
  /** Where downloaded models are kept (default: transformers' cache inside node_modules, lost on reinstall). */
  readonly cacheDir?: string;
}

type Extractor = (texts: string[], options: { pooling: "mean" | "cls"; normalize: boolean }) => Promise<{ tolist(): unknown }>;

export function transformersEmbedder(options: TransformersOptions = {}): Embedder {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const dtype = options.dtype ?? "q8";
  const profile = PROFILES[model] ?? { pooling: "mean", query: "", passage: "" };
  const batch = options.batchSize ?? 16;
  let loading: Promise<Extractor> | undefined;
  const load = (): Promise<Extractor> => {
    loading ??= (async () => {
      try {
        const { env, pipeline } = await import("@huggingface/transformers");
        if (options.cacheDir) env.cacheDir = options.cacheDir;
        return (await pipeline("feature-extraction", model, { dtype })) as unknown as Extractor;
      } catch (err) {
        loading = undefined;
        throw new RetrievalError("MODEL_UNAVAILABLE", `embedding model ${model} could not be loaded: ${String(err)}`, { cause: err });
      }
    })();
    return loading;
  };
  return {
    id: `transformers:${model}:${dtype}`,
    async embed(texts, kind) {
      const extract = await load();
      const prefix = kind === "query" ? profile.query : profile.passage;
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += batch) {
        const t = await extract(
          texts.slice(i, i + batch).map((x) => prefix + x),
          { pooling: profile.pooling, normalize: true },
        );
        out.push(...(t.tolist() as number[][]));
      }
      return out;
    },
  };
}
