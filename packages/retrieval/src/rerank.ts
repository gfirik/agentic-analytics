// Cross-encoder reranking (retrieval spec §3) in-process through @huggingface/transformers. Optional: without
// it, search keeps the fused order and reports `degraded: rerank`.
import type { Reranker } from "./types.ts";
import { RetrievalError } from "./types.ts";

export const DEFAULT_RERANK_MODEL = "onnx-community/bge-reranker-v2-m3-ONNX";

export interface RerankOptions {
  readonly model?: string;
  readonly dtype?: "fp32" | "fp16" | "q8" | "q4";
  readonly batchSize?: number;
  /** Where downloaded models are kept (see TransformersOptions.cacheDir). */
  readonly cacheDir?: string;
}

interface Loaded {
  readonly tokenizer: (a: string[], o: { text_pair: string[]; padding: boolean; truncation: boolean }) => unknown;
  readonly model: (inputs: unknown) => Promise<{ logits: { data: ArrayLike<number>; dims: readonly number[] } }>;
}

export function transformersReranker(options: RerankOptions = {}): Reranker {
  const model = options.model ?? DEFAULT_RERANK_MODEL;
  const dtype = options.dtype ?? "q8";
  const batch = options.batchSize ?? 8;
  let loading: Promise<Loaded> | undefined;
  const load = (): Promise<Loaded> => {
    loading ??= (async () => {
      try {
        const t = await import("@huggingface/transformers");
        if (options.cacheDir) t.env.cacheDir = options.cacheDir;
        const tokenizer = await t.AutoTokenizer.from_pretrained(model);
        const m = await t.AutoModelForSequenceClassification.from_pretrained(model, { dtype });
        return { tokenizer: tokenizer as unknown as Loaded["tokenizer"], model: m as unknown as Loaded["model"] };
      } catch (err) {
        loading = undefined;
        throw new RetrievalError("MODEL_UNAVAILABLE", `rerank model ${model} could not be loaded: ${String(err)}`, { cause: err });
      }
    })();
    return loading;
  };
  return {
    id: `transformers:${model}:${dtype}`,
    async score(query, documents) {
      const { tokenizer, model: m } = await load();
      const scores: number[] = [];
      for (let i = 0; i < documents.length; i += batch) {
        const docs = documents.slice(i, i + batch);
        const inputs = tokenizer(
          docs.map(() => query),
          { text_pair: [...docs], padding: true, truncation: true },
        );
        const { logits } = await m(inputs);
        // One relevance logit per pair (single-label head); take the first column if there are more.
        const cols = logits.dims[1] ?? 1;
        for (let r = 0; r < docs.length; r++) scores.push(Number(logits.data[r * cols]));
      }
      return scores;
    },
  };
}
