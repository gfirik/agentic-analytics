// Small-model input budget for DECIDE (agent-and-verifier §8.1). The fixture is the real DECIDE input of
// printing_shop-v1 from the 2026-10-17 small-model eval, which Groq refused at 7,804 input tokens (limit 7,000).
import { readFileSync } from "node:fs";
import { estimateTokens, schemaInstruction } from "@agentic-analytics/models";
import { FakeModel } from "@agentic-analytics/models/testing";
import { placeholders } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import {
  type DecideFinding,
  DecideOutput,
  decide,
  decideRequest,
  type FactSheet,
  QUOTE_MAX_CHARS,
  SMALL_MODEL_INPUT_BUDGET,
  TRIM_STEPS,
  trimDecideInput,
} from "../src/index.ts";

interface Fixture {
  readonly provider_input_tokens: number;
  readonly objective: string;
  readonly period_end: string;
  readonly findings: DecideFinding[];
  readonly factsheet: FactSheet;
}
const fx = JSON.parse(readFileSync(new URL("./fixtures/printing-shop-v1-decide.json", import.meta.url), "utf8")) as Fixture;
const input = { objective: fx.objective, findings: fx.findings, factsheet: fx.factsheet, periodEnd: fx.period_end };

type AnyFact = { id: string; value: number; unit: string; label?: string };
const sheetFacts = (s: { insights: { facts: Record<string, AnyFact> }[]; decompositions: { facts: Record<string, AnyFact> }[] }) =>
  [...s.insights, ...s.decompositions].flatMap((x) => Object.values(x.facts));

describe("DECIDE input budget, printing_shop-v1 (small-model mode)", () => {
  it("the untrimmed request is what DECIDE sent before budgets, and the estimate is not below the provider's count", () => {
    const full = decideRequest(input);
    expect(full.steps).toEqual([]);
    // As sent to Groq: system prompt + schema instruction, then the user prompt, one chat message each.
    const sent = estimateTokens(`${full.system}${schemaInstruction(DecideOutput)}`) + estimateTokens(full.prompt) + 16;
    expect(sent).toBeGreaterThanOrEqual(fx.provider_input_tokens);
    expect(full.untrimmed).toBeGreaterThan(SMALL_MODEL_INPUT_BUDGET);
  });

  it("fits the 6,500-token budget after trimming, and says which steps it took", () => {
    const r = decideRequest({ ...input, maxInputTokens: SMALL_MODEL_INPUT_BUDGET });
    expect(r.estimate).toBeLessThanOrEqual(SMALL_MODEL_INPUT_BUDGET);
    expect(r.untrimmed).toBeGreaterThan(SMALL_MODEL_INPUT_BUDGET);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.steps).toEqual(TRIM_STEPS.slice(0, r.steps.length));
    // Hand check, printed for the PR: estimated tokens before → after.
    process.stdout.write(`printing_shop-v1 DECIDE: ${r.untrimmed} → ${r.estimate} estimated tokens (steps: ${r.steps.join(", ")})\n`);
  });

  it("trims deterministically", () => {
    const a = decideRequest({ ...input, maxInputTokens: SMALL_MODEL_INPUT_BUDGET });
    const b = decideRequest({ ...structuredClone(input), maxInputTokens: SMALL_MODEL_INPUT_BUDGET });
    expect(b.system).toBe(a.system);
    expect(b.estimate).toBe(a.estimate);
  });

  it("never changes a number, keeps every fact a finding cites, and keeps findings and placeholders intact", () => {
    const full = new Map(sheetFacts(fx.factsheet as never).map((f) => [f.id, f]));
    const cited = new Set(fx.findings.flatMap((f) => f.claims.flatMap((c) => placeholders(c))));
    for (let n = 1; n <= TRIM_STEPS.length; n++) {
      const t = trimDecideInput(fx.factsheet, fx.findings, TRIM_STEPS.slice(0, n));
      const kept = sheetFacts(t.sheet as never);
      for (const f of kept) {
        const orig = full.get(f.id);
        expect(orig, f.id).toBeDefined();
        expect({ id: f.id, value: f.value, unit: f.unit }).toEqual({ id: orig?.id, value: orig?.value, unit: orig?.unit });
      }
      const keptIds = new Set(kept.map((f) => f.id));
      for (const id of cited) if (full.has(id)) expect(keptIds.has(id), `${id} after ${n} steps`).toBe(true);
      expect(t.findings.map((f) => f.id)).toEqual(fx.findings.map((f) => f.id));
      // Claims with placeholders are never shortened; only quotes are.
      t.findings.forEach((f, i) => {
        f.claims.forEach((c, j) => {
          const orig = fx.findings[i]?.claims[j] ?? "";
          if (placeholders(orig).length) expect(c).toBe(orig);
          else expect(orig.startsWith(c.replace(/…$/, ""))).toBe(true);
        });
      });
      // Every metric a kept insight measures is still defined, so a check can name it.
      for (const i of t.sheet.insights) expect(t.sheet.metrics.some((m) => m.id === i.metric)).toBe(true);
    }
  });

  it("refuses before sending when even the last step doesn't fit; DECIDE then ships no recommendations", async () => {
    expect(() => decideRequest({ ...input, maxInputTokens: 1500 })).toThrow(expect.objectContaining({ code: "INPUT_TOO_LARGE" }));
    const model = new FakeModel([{ role: "planner", repeat: true, object: { candidates: [] } }]);
    const finding = {
      id: "F1",
      type: "regression",
      title: "Revenue fell",
      claims: [{ text: "Revenue fell.", facts: [], citations: [], causal_grade: "observed", verified: false }],
    };
    const r = await decide({
      model,
      findings: [finding],
      objective: fx.objective,
      factsheet: fx.factsheet,
      periodEnd: fx.period_end,
      maxRecommendations: 2,
      maxInputTokens: 1500,
    } as unknown as Parameters<typeof decide>[0]);
    // Degrades like an invalid answer: the findings stand, no recommendations, and the reason is recorded.
    expect(r.recommendations).toEqual([]);
    expect(r.dropped).toEqual([
      { claim: "(candidate actions)", reason: expect.stringMatching(/^the DECIDE request is about .*budget of 1500; it was not sent$/) },
    ]);
    expect(model.calls).toEqual([]);
  });

  it("keeps facts a claim cites only in its facts list (claim.facts), not just those in its text", () => {
    // N317 (Northgate School) is not among the top members of X1 and no claim text names it.
    const steps = TRIM_STEPS.slice(0, 2);
    const ids = (t: ReturnType<typeof trimDecideInput>) => new Set(sheetFacts(t.sheet as never).map((f) => f.id));
    expect(ids(trimDecideInput(fx.factsheet, fx.findings, steps)).has("N317")).toBe(false);
    expect(ids(trimDecideInput(fx.factsheet, fx.findings, steps, ["N317"])).has("N317")).toBe(true);
  });

  it("cuts quotes by characters, never splitting one", () => {
    const quote = `“${"é😀".repeat(200)}”`;
    const t = trimDecideInput(fx.factsheet, [{ id: "F1", type: "x", title: "t", claims: [quote] }], ["short_quotes"]);
    const c = t.findings[0]?.claims[0] ?? "";
    expect([...c].length).toBe(QUOTE_MAX_CHARS);
    expect(c).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("without a budget (normal mode) the request is untouched, however large", () => {
    const r = decideRequest(input);
    expect(r.estimate).toBe(r.untrimmed);
    expect(r.system).toContain(JSON.stringify(fx.factsheet).replace(/</g, "\\u003c"));
  });
});
