// DECIDE (agent-and-verifier §6). The planner proposes 3–6 candidate actions, each naming the findings it
// addresses and a scenario over existing facts; code computes every impact range (analysis-library §5), scores
// the candidates by impact, confidence and effort, and keeps the top 2–5. A candidate with no finding, an
// impossible scenario, an unknown threshold fact or a check date that isn't after the data is dropped.
import { type ScenarioRequest, scenarioFacts } from "@agentic-analytics/analysis";
import type { Catalog, Grain } from "@agentic-analytics/metrics";
import type { ModelClient } from "@agentic-analytics/models";
import { type Fact, type Finding, findFreeNumerals, type MetricDef, placeholders, type Recommendation } from "@agentic-analytics/schema";
import type { Workspace } from "@agentic-analytics/store";
import { z } from "zod";
import type { Dropped } from "./explain.ts";
import type { Extract } from "./extractor.ts";
import { data, renderPrompt } from "./prompts.ts";

const noNumerals = (s: string) => findFreeNumerals(s).length === 0;
const NUMERALS = "write numbers only as {{N…}} fact placeholders; no other digits except dates and quoted source text";
const Text = z.string().min(3).max(400).refine(noNumerals, NUMERALS);
/** Actions, risks, horizons, not_advised: plain words only; numbers belong in the rationale, where they're checked. */
const Plain = Text.refine((t) => placeholders(t).length === 0, "no {{N…}} placeholders here; numbers belong in the rationale");

const Scenario = z.discriminatedUnion("type", [
  z.object({ type: z.literal("recover_share"), lost: z.string(), low: z.number(), high: z.number(), discount: z.number().optional() }),
  z.object({ type: z.literal("price_change"), revenue: z.string(), low: z.number(), high: z.number() }),
  z.object({
    type: z.literal("remove_excess_rate"),
    current: z.string(),
    baseline: z.string(),
    base: z.string(),
    low: z.number(),
    high: z.number(),
  }),
  z.object({ type: z.literal("retain_at_risk"), atRisk: z.string(), low: z.number(), high: z.number(), cost: z.number().optional() }),
]);

export const DecideOutput = z.object({
  candidates: z
    .array(
      z.object({
        action: Plain,
        because: z.array(z.string()).min(1).max(5),
        scenario: Scenario,
        justified_by: z.array(z.string()).max(5),
        rationale: z.object({ text: Text, facts: z.array(z.string()).max(8), extract_ids: z.array(z.string()).max(4) }),
        effort: z.enum(["low", "medium", "high"]),
        risk: Plain,
        confidence: z.enum(["high", "medium", "low"]),
        horizon: Plain,
        check: z.object({
          metric_id: z.string(),
          comparator: z.enum([">=", "<=", "between"]),
          threshold: z.string(),
          by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        }),
        not_advised: Plain.optional(),
      }),
    )
    .min(1)
    .max(6),
});
export type DecideOutput = z.infer<typeof DecideOutput>;

export interface DecideInput {
  readonly ws: Workspace;
  readonly defs: readonly MetricDef[];
  readonly catalog: Catalog;
  readonly grain: Grain;
  readonly model: ModelClient;
  readonly objective: string;
  readonly findings: readonly Finding[];
  readonly factsheet: string;
  readonly facts: () => Promise<Map<string, Fact>>;
  readonly extracts: ReadonlyMap<string, Extract>;
  /** Last day covered by the data; a check must be dated after it. */
  readonly periodEnd: string;
  /** Keep at most this many recommendations (5, or 2 in small-model mode). */
  readonly maxRecommendations: number;
}

const CONF = { high: 1, medium: 0.6, low: 0.3 } as const;
const EFFORT = { low: 1, medium: 1.5, high: 2 } as const;

export async function decide(input: DecideInput): Promise<{ recommendations: Recommendation[]; dropped: Dropped[] }> {
  const dropped: Dropped[] = [];
  if (!input.findings.length) return { recommendations: [], dropped };
  const { object } = await input.model.generateObject({
    role: "planner",
    schema: DecideOutput,
    system: renderPrompt("decide", {
      objective: input.objective,
      findings: data(input.findings.map((f) => ({ id: f.id, type: f.type, title: f.title, claims: f.claims.map((c) => c.text) }))),
      factsheet: input.factsheet,
      period_end: input.periodEnd,
    }),
    prompt: "Propose the candidate actions.",
  });
  const findingIds = new Set(input.findings.map((f) => f.id));
  const scored: { rec: Omit<Recommendation, "id">; score: number }[] = [];
  for (const c of object.candidates) {
    const drop = (reason: string) => dropped.push({ claim: c.action, reason });
    const because = c.because.filter((b) => findingIds.has(b));
    if (!because.length) {
      drop("no finding supports it");
      continue;
    }
    let facts = await input.facts();
    if (!facts.has(c.check.threshold)) {
      drop(`unknown threshold fact ${c.check.threshold}`);
      continue;
    }
    if (!input.defs.some((d) => d.id === c.check.metric_id)) {
      drop(`unknown metric ${c.check.metric_id}`);
      continue;
    }
    const thresholdMetric = facts.get(c.check.threshold)?.metric_id;
    if (thresholdMetric && thresholdMetric !== c.check.metric_id) {
      drop(`check threshold ${c.check.threshold} measures ${thresholdMetric}, not ${c.check.metric_id}`);
      continue;
    }
    if (!(c.check.by > input.periodEnd)) {
      drop(`check date ${c.check.by} is not after the data (${input.periodEnd})`);
      continue;
    }
    const rationaleIds = [...new Set([...c.rationale.facts, ...placeholders(c.rationale.text)])];
    const unknown = rationaleIds.find((id) => !facts.has(id)) ?? c.rationale.extract_ids.find((id) => !input.extracts.has(id));
    if (unknown) {
      drop(`rationale names unknown ${unknown}`);
      continue;
    }
    let impact: Awaited<ReturnType<typeof scenarioFacts>>;
    try {
      impact = await scenarioFacts(input.ws, input.defs, input.catalog, input.grain, c.scenario as ScenarioRequest, c.justified_by);
    } catch (err) {
      // A scenario the engine refuses (unknown fact, parameter out of range) is the candidate's problem and is
      // recorded; anything else is an engine failure and stops the stage.
      const code = err instanceof Error && "code" in err ? String(err.code) : "";
      if (!["UNKNOWN_FACT", "EXTERNAL_FACT", "PARAM_OUT_OF_RANGE", "BAD_RANGE", "UNKNOWN_SCENARIO"].includes(code)) throw err;
      drop(`scenario rejected: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    facts = await input.facts();
    const low = facts.get(impact.low)?.value ?? 0;
    const high = facts.get(impact.high)?.value ?? 0;
    const base = facts.get(scenarioBase(c.scenario));
    const metric_id =
      base?.metric_id ??
      input.findings
        .find((f) => f.id === because[0])
        ?.claims[0]?.facts.map((id) => facts.get(id)?.metric_id)
        .find(Boolean) ??
      c.check.metric_id;
    scored.push({
      score: ((Math.abs(low + high) / 2) * CONF[c.confidence]) / EFFORT[c.effort],
      rec: {
        action: c.action,
        because,
        rationale: [
          {
            text: c.rationale.text,
            facts: rationaleIds,
            citations: c.rationale.extract_ids.map((id) => {
              const e = input.extracts.get(id) as Extract;
              return { source_id: e.citation.source_id, quote: e.citation.quote };
            }),
            verified: false,
          },
        ],
        impact: {
          metric_id,
          low: impact.low,
          high: impact.high,
          horizon: c.horizon,
          method: impact.method,
          inputs: [scenarioBase(c.scenario), ...impact.params, ...c.justified_by],
        },
        confidence: c.confidence,
        effort: c.effort,
        risk: c.risk,
        check: c.check,
        ...(c.not_advised ? { not_advised: c.not_advised } : {}),
      },
    });
  }
  scored.sort((a, b) => b.score - a.score);
  const recommendations = scored.slice(0, input.maxRecommendations).map((s, i) => ({ id: `R${i + 1}`, ...s.rec }));
  for (const s of scored.slice(input.maxRecommendations))
    dropped.push({ claim: s.rec.action, reason: "ranked below the kept recommendations" });
  return { recommendations, dropped };
}

function scenarioBase(s: z.infer<typeof Scenario>): string {
  return s.type === "recover_share" ? s.lost : s.type === "price_change" ? s.revenue : s.type === "remove_excess_rate" ? s.base : s.atRisk;
}
