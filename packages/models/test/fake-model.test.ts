import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ModelError, type ToolSet } from "../src/index.ts";
import { FakeModel, promptHash } from "../src/testing/index.ts";

const Verdict = z.object({ metric: z.string(), material: z.boolean() });

describe("FakeModel", () => {
  it("returns a scripted object by role and prompt substring", async () => {
    const model = new FakeModel([{ role: "extractor", match: "revenue", object: { metric: "revenue", material: true } }]);
    const res = await model.generateObject({ role: "extractor", schema: Verdict, system: "s", prompt: "Is the revenue change material?" });
    expect(res.object).toEqual({ metric: "revenue", material: true });
    expect(model.remaining()).toEqual([]);
  });

  it("matches by prompt hash", async () => {
    const hash = promptHash("sys", "exact prompt");
    const model = new FakeModel([{ promptHash: hash, object: { metric: "x", material: false } }]);
    expect((await model.generateObject({ role: "judge", schema: Verdict, system: "sys", prompt: "exact prompt" })).object.metric).toBe("x");
  });

  it("retries an invalid object with the validation error fed back", async () => {
    const model = new FakeModel([
      { match: "q", object: { metric: 42 } },
      { match: "q", object: { metric: "refund_rate", material: true } },
    ]);
    const res = await model.generateObject({ role: "planner", schema: Verdict, system: "s", prompt: "q" });
    expect(res.object.metric).toBe("refund_rate");
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.prompt).toContain("rejected by validation");
  });

  it("raises INVALID_OUTPUT after the retries run out", async () => {
    const model = new FakeModel([{ match: "q", object: { nope: true }, repeat: true }]);
    await expect(model.generateObject({ role: "planner", schema: Verdict, system: "s", prompt: "q", maxRetries: 1 })).rejects.toMatchObject(
      {
        code: "INVALID_OUTPUT",
      },
    );
    expect(model.calls).toHaveLength(2);
  });

  it("runs scripted tool calls against the real tools, validating inputs", async () => {
    const seen: string[] = [];
    const tools: ToolSet = {
      get_facts: {
        description: "Look up facts",
        inputSchema: z.object({ ids: z.array(z.string()) }),
        execute: async (input) => {
          const ids = (input as { ids: string[] }).ids;
          seen.push(...ids);
          return ids.map((id) => ({ id, value: 1 }));
        },
      },
    };
    const model = new FakeModel([
      {
        role: "planner",
        steps: [
          {
            toolCalls: [
              { toolName: "get_facts", input: { ids: ["N4"] } },
              { toolName: "get_facts", input: { ids: 4 } },
              { toolName: "rm_rf", input: {} },
            ],
          },
          { text: "Revenue fell {{N4}}." },
        ],
      },
    ]);
    const res = await model.generateWithTools({
      role: "planner",
      system: "s",
      messages: [{ role: "user", content: "explain F1" }],
      tools,
      maxSteps: 5,
    });
    expect(seen).toEqual(["N4"]);
    expect(res.steps[0]?.toolCalls.map((c) => c.error ?? "ok")).toEqual([
      "ok",
      expect.stringContaining("invalid input"),
      "no such tool: rm_rf",
    ]);
    expect(res.steps[1]?.text).toBe("Revenue fell {{N4}}.");
    expect(res.usage.inputTokens).toBe(20);
  });

  it("caps tool loops at maxSteps", async () => {
    const model = new FakeModel([{ steps: [{ text: "1" }, { text: "2" }, { text: "3" }] }]);
    const res = await model.generateWithTools({
      role: "planner",
      system: "s",
      messages: [{ role: "user", content: "x" }],
      tools: {},
      maxSteps: 2,
    });
    expect(res.steps.map((s) => s.text)).toEqual(["1", "2"]);
  });

  it("fails loudly when nothing is scripted", async () => {
    const err = await new FakeModel()
      .generateObject({ role: "judge", schema: Verdict, system: "s", prompt: "unscripted" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).code).toBe("FAKE_NO_SCRIPT");
  });

  it("embeds deterministically, with related texts closer than unrelated ones", async () => {
    const model = new FakeModel();
    const [a, b, c] = await model.embed(["wholesale price increase", "wholesale price rise", "new barista started"]);
    const dot = (x: number[] = [], y: number[] = []) => x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0);
    expect(await model.embed(["wholesale price increase"])).toEqual([a]);
    expect(dot(a, b)).toBeGreaterThan(dot(a, c));
  });
});

describe("function-valued script entries", () => {
  it("build the object and the steps from the request, so scripts can name run-time ids", async () => {
    const { z } = await import("zod");
    const m = new FakeModel([
      { role: "planner", match: "pick", object: (r: { prompt: string }) => ({ id: r.prompt.split(" ")[1] }) },
      { role: "planner", match: "go", steps: (r: { prompt: string }) => [{ text: `saw ${r.prompt}` }] },
    ]);
    const o = await m.generateObject({ role: "planner", schema: z.object({ id: z.string() }), system: "s", prompt: "pick N42" });
    expect(o.object).toEqual({ id: "N42" });
    const t = await m.generateWithTools({
      role: "planner",
      system: "s",
      messages: [{ role: "user", content: "go now" }],
      tools: {},
      maxSteps: 3,
    });
    expect(t.steps.map((s) => s.text)).toEqual(["saw go now"]);
  });
});
