// DECIDE (agent-and-verifier §6). The planner proposes 3–6 candidate actions, each naming the findings it
// addresses and a scenario over existing facts; code computes every impact range (analysis-library §5), scores
// the candidates by impact, confidence and effort, and keeps the top 2–5. A candidate with no finding, an
// impossible scenario, an unknown threshold fact or a check date that isn't after the data is dropped.
import { type ScenarioRequest, scenarioFacts } from "@agentic-analytics/analysis";
import type { Catalog, Grain } from "@agentic-analytics/metrics";
import { type ModelClient, ModelError } from "@agentic-analytics/models";
import { type Fact, type Finding, findFreeNumerals, type MetricDef, placeholders, type Recommendation } from "@agentic-analytics/schema";
import type { Workspace } from "@agentic-analytics/store";
import { z } from "zod";
import { type BudgetedRequest, type DecideFinding, fitToBudget } from "./budget.ts";
import type { Dropped } from "./explain.ts";
import type { Extract } from "./extractor.ts";
import type { FactSheet } from "./factsheet.ts";
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

/** A candidate action as DECIDE keeps it: every prose rule holds (§6). */
const Candidate = z.object({
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
});
type Candidate = z.infer<typeof Candidate>;

export const DecideOutput = z.object({ candidates: z.array(Candidate).min(1).max(6) });
export type DecideOutput = z.infer<typeof DecideOutput>;

/**
 * The same shape with the prose unchecked, as the model's answer is read: each candidate is then repaired and held to
 * `Candidate` on its own (`repairCandidate`), so one candidate's stray numeral costs that candidate, not the set. In
 * the nightly runs a free numeral in one field ("a 5% tier", "within 30 days") failed the whole answer three times
 * over in 38 of 69 DECIDE responses; read per candidate, 64 of the 69 keep at least one (M14a). The answer is retried
 * only when no candidate survives.
 */
const AnswerCandidate = Candidate.extend({
  action: z.string(),
  rationale: z.object({ text: z.string(), facts: z.array(z.string()).max(8), extract_ids: z.array(z.string()).max(4) }),
  risk: z.string(),
  horizon: z.string(),
  not_advised: z.string().nullable().optional(),
});
type AnswerCandidate = z.infer<typeof AnswerCandidate>;

const firstIssue = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".")}: ${i.message}`)[0] ?? "invalid";
const plainOk = (t: unknown): t is string => Plain.safeParse(t).success;
/** The sentences of a text that hold the plain-words rule (a sentence with a numeral or a placeholder is left out). */
const plainSentences = (t: string) =>
  (t.match(/[^.!?;]+[.!?;]?/g) ?? [])
    .map((s) => s.trim())
    .filter(plainOk)
    .join(" ");

/**
 * One candidate held to the full rules, after the only repairs that add nothing: an optional `not_advised` that
 * breaks a rule (empty, a numeral) is left out, and `risk` and `horizon` keep only their sentences without numerals.
 * The action, rationale, scenario and check are never repaired: a candidate whose rationale carries a free numeral
 * is dropped with its reason.
 */
export function repairCandidate(c: AnswerCandidate): { readonly candidate: Candidate } | { readonly reason: string } {
  const { not_advised, ...rest } = c;
  const fixed = {
    ...rest,
    risk: plainOk(c.risk) ? c.risk : plainSentences(c.risk),
    horizon: plainOk(c.horizon) ? c.horizon : plainSentences(c.horizon),
    ...(plainOk(not_advised) ? { not_advised } : {}),
  };
  const r = Candidate.safeParse(fixed);
  return r.success ? { candidate: r.data } : { reason: firstIssue(r.error) };
}

/**
 * Ids bound by what they are, not by how the model named them (M14a), only where exactly one reading exists:
 * - the check measures the metric its threshold fact measures, when that is a known definition (the model wrote
 *   `corporate_revenue` with a `revenue` threshold: the check compares revenue with revenue);
 * - an extract named by its file (`price-notice.pdf`) is that file's extract, when the file has exactly one.
 * Anything else is left as written, and the checks that follow drop it with its reason.
 */
export function bindIds(
  c: Candidate,
  facts: ReadonlyMap<string, Fact>,
  extracts: ReadonlyMap<string, Extract>,
  defs: readonly MetricDef[],
): Candidate {
  const measured = facts.get(c.check.threshold)?.metric_id;
  const metric = measured && defs.some((d) => d.id === measured) ? measured : c.check.metric_id;
  const byFile = (id: string) => {
    if (extracts.has(id)) return id;
    const same = [...extracts.values()].filter((e) => e.file === id);
    return same.length === 1 && same[0] ? same[0].id : id;
  };
  return {
    ...c,
    check: { ...c.check, metric_id: metric },
    rationale: { ...c.rationale, extract_ids: c.rationale.extract_ids.map(byFile) },
  };
}

export const DecideAnswer = z.object({ candidates: z.array(AnswerCandidate).min(1).max(6) }).superRefine((o, ctx) => {
  const reasons = o.candidates.map(repairCandidate).flatMap((r) => ("reason" in r ? [r.reason] : []));
  if (reasons.length === o.candidates.length)
    ctx.addIssue({ code: "custom", path: ["candidates"], message: `no candidate holds the rules; the first: ${reasons[0]}` });
});
export type DecideAnswer = z.infer<typeof DecideAnswer>;

export interface DecideInput {
  readonly ws: Workspace;
  readonly defs: readonly MetricDef[];
  readonly catalog: Catalog;
  readonly grain: Grain;
  readonly model: ModelClient;
  readonly objective: string;
  readonly findings: readonly Finding[];
  readonly factsheet: FactSheet;
  readonly facts: () => Promise<Map<string, Fact>>;
  readonly extracts: ReadonlyMap<string, Extract>;
  /** Last day covered by the data; a check must be dated after it. */
  readonly periodEnd: string;
  /** Keep at most this many recommendations (5, or 2 in small-model mode). */
  readonly maxRecommendations: number;
  /** Input budget in estimated tokens (SMALL_MODEL_INPUT_BUDGET in small-model mode, §8.1); none by default. */
  readonly maxInputTokens?: number;
}

/** What DECIDE sends, the request's estimated size before and after trimming, and the trimming steps applied. */
export type DecideRequest = BudgetedRequest;

/**
 * The DECIDE request (§6), fitted to `maxInputTokens` by trimming the fact sheet and findings (§8.1). Without a
 * budget it is the full request, byte for byte what DECIDE sent before budgets existed.
 */
export function decideRequest(input: {
  readonly objective: string;
  readonly findings: readonly DecideFinding[];
  readonly factsheet: FactSheet;
  readonly periodEnd: string;
  readonly maxInputTokens?: number;
  /** Fact ids the findings' claims cite (`claim.facts`); kept by trimming like those in the claim text. */
  readonly cites?: readonly string[];
}): DecideRequest {
  return fitToBudget(
    (sheet, findings) => ({
      schema: DecideAnswer,
      system: renderPrompt("decide", {
        objective: input.objective,
        findings: data(findings),
        factsheet: data(sheet),
        period_end: input.periodEnd,
      }),
      prompt: "Propose the candidate actions.",
    }),
    input.factsheet,
    input.findings,
    input.maxInputTokens,
    input.cites,
  );
}

const CONF = { high: 1, medium: 0.6, low: 0.3 } as const;
const EFFORT = { low: 1, medium: 1.5, high: 2 } as const;

export async function decide(
  input: DecideInput,
): Promise<{ recommendations: Recommendation[]; dropped: Dropped[]; request?: Pick<DecideRequest, "estimate" | "untrimmed" | "steps"> }> {
  const dropped: Dropped[] = [];
  if (!input.findings.length) return { recommendations: [], dropped };
  let req: DecideRequest;
  try {
    req = decideRequest({
      objective: input.objective,
      findings: input.findings.map((f) => ({ id: f.id, type: f.type, title: f.title, claims: f.claims.map((c) => c.text) })),
      factsheet: input.factsheet,
      periodEnd: input.periodEnd,
      cites: input.findings.flatMap((f) => f.claims.flatMap((c) => c.facts)),
      ...(input.maxInputTokens !== undefined ? { maxInputTokens: input.maxInputTokens } : {}),
    });
  } catch (err) {
    // Still over the input budget after every trimming step (§8.1): nothing is sent. Like an invalid answer, this
    // costs the recommendations, not the verified findings; the reason is recorded.
    if (!(err instanceof ModelError && err.code === "INPUT_TOO_LARGE")) throw err;
    dropped.push({ claim: "(candidate actions)", reason: err.message });
    return { recommendations: [], dropped };
  }
  const request = { estimate: req.estimate, untrimmed: req.untrimmed, steps: req.steps };
  let object: DecideAnswer;
  try {
    ({ object } = await input.model.generateObject({
      role: "planner",
      schema: DecideAnswer,
      system: req.system,
      prompt: req.prompt,
      ...(input.maxInputTokens !== undefined ? { maxInputTokens: input.maxInputTokens } : {}),
    }));
  } catch (err) {
    // The model couldn't produce valid candidate actions even after the validation retries (models §5). The
    // findings still stand: the report ships with no recommendations, and the reason is recorded.
    if (!(err instanceof Error && "code" in err && err.code === "INVALID_OUTPUT")) throw err;
    dropped.push({ claim: "(candidate actions)", reason: `the model's candidate actions failed validation: ${err.message.slice(0, 200)}` });
    return { recommendations: [], dropped, request };
  }
  const findingIds = new Set(input.findings.map((f) => f.id));
  const scored: { rec: Omit<Recommendation, "id">; score: number }[] = [];
  for (const answered of object.candidates) {
    const repaired = repairCandidate(answered);
    if ("reason" in repaired) {
      dropped.push({ claim: "(candidate action)", reason: `breaks the output rules: ${repaired.reason}` });
      continue;
    }
    const drop = (reason: string) => dropped.push({ claim: repaired.candidate.action, reason });
    const because = repaired.candidate.because.filter((b) => findingIds.has(b));
    if (!because.length) {
      drop("no finding supports it");
      continue;
    }
    let facts = await input.facts();
    const c = bindIds(repaired.candidate, facts, input.extracts, input.defs);
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
  return { recommendations, dropped, request };
}

function scenarioBase(s: z.infer<typeof Scenario>): string {
  return s.type === "recover_share" ? s.lost : s.type === "price_change" ? s.revenue : s.type === "remove_excess_rate" ? s.base : s.atRisk;
}
