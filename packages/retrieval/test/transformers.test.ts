// The transformers.js wrappers with the library mocked: no download, no network. Checks pooling and instruction
// prefixes per model, batching, logits indexing and typed load errors.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { texts: string[]; options: unknown }[] = [];
const state = { failLoad: false };

vi.mock("@huggingface/transformers", () => ({
  env: {},
  pipeline: async (_task: string, model: string) => {
    if (state.failLoad) throw new Error(`cannot download ${model}`);
    return async (texts: string[], options: unknown) => {
      calls.push({ texts, options });
      return { tolist: () => texts.map((t) => [t.length, 1]) };
    };
  },
  AutoTokenizer: {
    from_pretrained: async () => (queries: string[], o: { text_pair: string[] }) => ({ n: queries.length, pairs: o.text_pair }),
  },
  AutoModelForSequenceClassification: {
    // Two logit columns per row: the wrapper must read column 0 of each row.
    from_pretrained: async () => async (inputs: { pairs: string[] }) => ({
      logits: { data: inputs.pairs.flatMap((d) => [d.length, -1]), dims: [inputs.pairs.length, 2] },
    }),
  },
}));

const { transformersEmbedder, transformersReranker } = await import("../src/index.ts");

beforeEach(() => {
  calls.length = 0;
  state.failLoad = false;
});

describe("transformersEmbedder", () => {
  it("e5 models get query:/passage: prefixes and mean pooling; batches of batchSize", async () => {
    const e = transformersEmbedder({ model: "Xenova/multilingual-e5-small", batchSize: 2 });
    expect(e.id).toBe("transformers:Xenova/multilingual-e5-small:q8");
    const out = await e.embed(["a", "bb", "ccc"], "passage");
    expect(calls.map((c) => c.texts)).toEqual([["passage: a", "passage: bb"], ["passage: ccc"]]);
    expect(calls[0]?.options).toEqual({ pooling: "mean", normalize: true });
    expect(out).toEqual([
      [10, 1],
      [11, 1],
      [12, 1],
    ]);
    await e.embed(["q"], "query");
    expect(calls.at(-1)?.texts).toEqual(["query: q"]);
  });

  it("bge-m3 uses CLS pooling and no prefix", async () => {
    await transformersEmbedder().embed(["x"], "query");
    expect(calls[0]).toEqual({ texts: ["x"], options: { pooling: "cls", normalize: true } });
  });

  it("a model that can't load is a typed MODEL_UNAVAILABLE error, and a later call retries", async () => {
    state.failLoad = true;
    const e = transformersEmbedder({ model: "Xenova/bge-m3" });
    await expect(e.embed(["x"], "query")).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    state.failLoad = false;
    await expect(e.embed(["x"], "query")).resolves.toHaveLength(1);
  });
});

describe("transformersReranker", () => {
  it("scores one logit per (query, document) pair, in order, across batches", async () => {
    const r = transformersReranker({ batchSize: 2 });
    expect(await r.score("q", ["a", "bbb", "cc"])).toEqual([1, 3, 2]);
  });
});
