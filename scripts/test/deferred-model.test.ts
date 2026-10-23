// scripts/deferred-model.mjs: the deferred slot's Groq model. The fixture is Groq's real /models list on 2026-10-23,
// when no preferred model was served any more and the only general chat models were the full suite's three.
import { describe, expect, it } from "vitest";
import { pickModel, routeModels } from "../deferred-model.mjs";

const GROQ_2026_10_23 = [
  { id: "allam-2-7b", context_window: 4096 },
  { id: "canopylabs/orpheus-arabic-saudi", context_window: 4000 },
  { id: "canopylabs/orpheus-v1-english", context_window: 4000 },
  { id: "meta-llama/llama-prompt-guard-2-22m", context_window: 512 },
  { id: "meta-llama/llama-prompt-guard-2-86m", context_window: 512 },
  { id: "openai/gpt-oss-120b", context_window: 131072 },
  { id: "openai/gpt-oss-20b", context_window: 131072 },
  { id: "openai/gpt-oss-safeguard-20b", context_window: 131072 },
  { id: "qwen/qwen3.8-27b", context_window: 131072 },
  { id: "whisper-large-v3", context_window: 448 },
  { id: "whisper-large-v3-turbo", context_window: 448 },
];
const ROLES = {
  PLANNER_MODEL: "openai-compatible:groq:qwen/qwen3.8-27b",
  EXTRACTOR_MODEL: "openai-compatible:groq:openai/gpt-oss-120b",
  JUDGE_MODEL: "openai-compatible:groq:openai/gpt-oss-20b",
  SMALL_MODEL: "",
};

describe("deferred-model", () => {
  it("reads the Groq models a role names, from a route list", () => {
    expect(routeModels("openai-compatible:groq:a | ollama:b|openai-compatible:groq:c")).toEqual(["a", "c"]);
    expect(routeModels(undefined)).toEqual([]);
  });

  it("on Groq's list of 2026-10-23 shares the judge's model: no unused chat model is served, and the guards, speech and small-window models don't count", () => {
    expect(pickModel(GROQ_2026_10_23, ROLES)).toEqual({ model: "openai/gpt-oss-20b", shared: "JUDGE_MODEL" });
  });

  it("prefers a model the full suite doesn't use, in the preferred order, then any unused chat model", () => {
    const more = [...GROQ_2026_10_23, { id: "qwen/qwen3-32b", context_window: 131072 }, { id: "new/model", context_window: 65536 }];
    expect(pickModel(more, ROLES)).toEqual({ model: "qwen/qwen3-32b", shared: null });
    const unknown = [...GROQ_2026_10_23, { id: "new/model", context_window: 65536 }];
    expect(pickModel(unknown, ROLES)).toEqual({ model: "new/model", shared: null });
  });

  it("falls back to the extractor's model, never the planner's, and says so when nothing fits", () => {
    const noJudge = GROQ_2026_10_23.filter((m) => m.id !== "openai/gpt-oss-20b");
    expect(pickModel(noJudge, ROLES)).toEqual({ model: "openai/gpt-oss-120b", shared: "EXTRACTOR_MODEL" });
    const plannerOnly = GROQ_2026_10_23.filter((m) => !m.id.startsWith("openai/gpt-oss-"));
    expect(pickModel(plannerOnly, ROLES).error).toMatch(/no served chat model fits/);
  });

  it("skips models Groq marks inactive", () => {
    const inactive = [...GROQ_2026_10_23, { id: "qwen/qwen3-32b", context_window: 131072, active: false }];
    expect(pickModel(inactive, ROLES).model).toBe("openai/gpt-oss-20b");
  });
});
