// `aa eval --passes` and the row name of `--model configured` (docs/EVALS.md §3–4): the nightly run's wiring.

import { EvalRunError } from "@agentic-analytics/eval-runner";
import { describe, expect, it } from "vitest";
import { nightlyArgs } from "../src/eval-args.ts";

const groq = (model: string) => ({ provider: "openai-compatible", endpoint: "groq", model });
const models = () => ({ planner: groq("qwen/qwen3.8-27b"), extractor: groq("openai/gpt-oss-120b"), judge: groq("openai/gpt-oss-20b") });

describe("nightlyArgs", () => {
  it("names a configured run after its routes and passes each role's model, with --passes as a number", () => {
    expect(nightlyArgs({ model: "configured", passes: "2" }, models)).toEqual({
      passes: 2,
      name: "openai-compatible:groq:qwen/qwen3.8-27b planner, gpt-oss-120b extractor, gpt-oss-20b judge",
      roleModels: { planner: "qwen3.8-27b", extractor: "gpt-oss-120b", judge: "gpt-oss-20b" },
    });
  });
  it("keeps a --label as the name, and reads no config for another model", () => {
    expect(nightlyArgs({ model: "configured", label: "mine" }, models).name).toBeUndefined();
    expect(
      nightlyArgs({ model: "baseline" }, () => {
        throw new Error("config read");
      }),
    ).toEqual({});
  });
  it("refuses a --passes that isn't a whole number ≥ 1", () => {
    for (const bad of ["0", "1.5", "two", "-1", ""])
      expect(() => nightlyArgs({ model: "baseline", passes: bad }, models)).toThrow(/whole number ≥ 1/);
    expect(() => nightlyArgs({ model: "baseline", passes: "0" }, models)).toThrow(EvalRunError);
  });
});
