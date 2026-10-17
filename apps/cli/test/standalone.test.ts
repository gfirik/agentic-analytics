import { describe, expect, it } from "vitest";
import { embedderChoice, onlyProblem, resultsLocation, runtimeVersion } from "../src/standalone.ts";

const bin = { AA_STANDALONE: "1" };

describe("standalone binary choices", () => {
  it("eval results: the flag's folder (page inside it); the checkout's evals/results (page beside); ./eval-results in the binary", () => {
    const flag = resultsLocation("/out", bin, "/work", "/repo/evals/results");
    expect([flag.dir, flag.page?.replace(/\\/g, "/")]).toEqual(["/out", "/out/RESULTS.md"]);
    expect(resultsLocation(undefined, {}, "/work", "/repo/evals/results")).toEqual({ dir: "/repo/evals/results" });
    const b = resultsLocation(undefined, bin, "/work", "/$bunfs/evals/results");
    expect([b.dir, b.page].map((p) => p?.replace(/\\/g, "/"))).toEqual(["/work/eval-results", "/work/eval-results/RESULTS.md"]);
    // Your own answer files (--answers): never into the project's published results.
    const own = resultsLocation(undefined, {}, "/work", "/repo/evals/results", true);
    expect([own.dir, own.page].map((p) => p?.replace(/\\/g, "/"))).toEqual(["/work/eval-results", "/work/eval-results/RESULTS.md"]);
  });

  it("--only (a chunk of a suite) needs a --results-dir that isn't the checkout's evals/results", () => {
    const repo = "/repo/evals/results";
    expect(onlyProblem(undefined, undefined, "/work", repo)).toBeUndefined();
    expect(onlyProblem("saas-v2", undefined, "/work", repo)).toMatch(/needs --results-dir/);
    expect(onlyProblem("saas-v2", "/repo/evals/results", "/work", repo)).toMatch(/can't write to/);
    // The same folder spelled relative to the working directory, or with a trailing slash.
    expect(onlyProblem("saas-v2", "evals/results/", "/repo", repo)).toMatch(/can't write to/);
    expect(onlyProblem("saas-v2", "../repo/evals/./results", "/work", repo)).toMatch(/can't write to/);
    expect(onlyProblem("saas-v2", "chunks/saas-v2", "/repo", repo)).toBeUndefined();
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
