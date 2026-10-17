// Input budget (models §5): the conservative token estimate and the refusal of an over-budget call before sending.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  boundedFeedback,
  estimateObjectRequest,
  estimateTokens,
  FEEDBACK_MAX_CHARS,
  feedbackSuffix,
  schemaInstruction,
} from "../src/index.ts";
import { FakeModel } from "../src/testing/index.ts";

describe("estimateTokens", () => {
  it("counts digits and non-ASCII characters one each, the rest at 3.2 characters a token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("12345")).toBe(5);
    expect(estimateTokens("abcdefgh")).toBe(3); // ⌈8 / 3.2⌉
    expect(estimateTokens("“ok”")).toBe(3); // two curly quotes + ⌈2 / 3.2⌉
    expect(estimateTokens("N12: 3.5")).toBe(6); // four digits + ⌈4 / 3.2⌉ for "N", ":", " ", "."
    expect(estimateTokens("😀")).toBe(1); // one code point, not two UTF-16 units
  });

  it("estimates a request as system + schema + prompt + the longest retry feedback + two messages", () => {
    const schema = z.object({ a: z.string() });
    const args = { system: "You are terse.", prompt: "Say hi.", schema };
    const base = estimateTokens(args.system) + estimateTokens(schemaInstruction(schema)) + estimateTokens(args.prompt) + 16;
    expect(estimateObjectRequest({ ...args, maxRetries: 0 })).toBe(base);
    expect(estimateObjectRequest(args)).toBe(base + estimateTokens(feedbackSuffix("")) + FEEDBACK_MAX_CHARS);
  });
});

describe("maxInputTokens", () => {
  const schema = z.object({ answer: z.string() });

  it("refuses an over-budget call with INPUT_TOO_LARGE before anything is sent", async () => {
    const model = new FakeModel([{ role: "planner", object: { answer: "x" } }]);
    const system = "word ".repeat(2000);
    await expect(model.generateObject({ role: "planner", schema, system, prompt: "Go.", maxInputTokens: 1000 })).rejects.toMatchObject({
      code: "INPUT_TOO_LARGE",
    });
    expect(model.calls).toEqual([]);
  });

  it("sends a call within budget, and cuts retry feedback so retries stay within it", async () => {
    const model = new FakeModel([
      { role: "planner", object: { answer: 1 } },
      { role: "planner", object: { answer: "ok" } },
    ]);
    const long = z.object({ answer: z.string({ error: "e".repeat(800) }) });
    const { object } = await model.generateObject({ role: "planner", schema: long, system: "s", prompt: "Go.", maxInputTokens: 2000 });
    expect(object).toEqual({ answer: "ok" });
    const retry = model.calls[1]?.prompt ?? "";
    expect(retry).toContain("rejected by validation: answer: eee");
    expect(retry.length).toBe("Go.".length + feedbackSuffix("").length + FEEDBACK_MAX_CHARS);
  });

  it("keeps the reason, not the echoed answer, of the AI SDK's validation message", () => {
    // The shape the SDK produced in the 2026-10-17 Groq eval (coffee_roaster-v1 DECIDE retry), shortened.
    const sdk = `Type validation failed: Value: {"candidates":[{"action":"${"x".repeat(2000)}"}]}.\nError message: [\n  {\n    "code": "custom",\n    "path": [\n      "candidates",\n      2,\n      "risk"\n    ],\n    "message": "write numbers only as {{N…}} fact placeholders"\n  }\n]`;
    expect(boundedFeedback(sdk)).toBe("candidates.2.risk: write numbers only as {{N…}} fact placeholders");
    expect([...boundedFeedback("y".repeat(1000))].length).toBe(FEEDBACK_MAX_CHARS);
  });

  it("leaves calls without a budget as they were (feedback quoted in full)", async () => {
    const model = new FakeModel([
      { role: "planner", object: { answer: 1 } },
      { role: "planner", object: { answer: "ok" } },
    ]);
    const long = z.object({ answer: z.string({ error: "e".repeat(800) }) });
    await model.generateObject({ role: "planner", schema: long, system: "s", prompt: "Go." });
    expect(model.calls[1]?.prompt).toContain("e".repeat(800));
  });
});
