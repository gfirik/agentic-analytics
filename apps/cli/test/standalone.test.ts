import { describe, expect, it } from "vitest";
import { embedderChoice, resultsDir, runtimeVersion } from "../src/standalone.ts";

const bin = { AA_STANDALONE: "1" };

describe("standalone binary choices", () => {
  it("eval results: the flag wins; else the checkout's evals/results, or ./eval-results in the binary", () => {
    expect(resultsDir("/out", bin, "/work", "/repo/evals/results")).toBe("/out");
    expect(resultsDir(undefined, {}, "/work", "/repo/evals/results")).toBe("/repo/evals/results");
    expect(resultsDir(undefined, bin, "/work", "/$bunfs/evals/results")).toMatch(/^[/\\]work[/\\]eval-results$/);
  });

  it("embedder: hash when asked, hash with a notice by default in the binary, an explicit model always wins", () => {
    expect(embedderChoice("hash", {})).toEqual({ kind: "hash" });
    expect(embedderChoice(undefined, {})).toEqual({ kind: "onnx" });
    expect(embedderChoice(undefined, bin)).toMatchObject({ kind: "hash", notice: expect.stringMatching(/^Standalone binary/) });
    expect(embedderChoice("Xenova/bge-m3", bin)).toEqual({ kind: "onnx", model: "Xenova/bge-m3" });
  });

  it("doctor names the Bun runtime in the binary", () => {
    expect(runtimeVersion(bin, { bun: "1.4.3" }, "v26.3.0")).toBe("v26.3.0 (Node API of the Bun 1.4.3 runtime)");
    expect(runtimeVersion({}, { bun: undefined }, "v22.13.0")).toBe("v22.13.0");
  });
});
