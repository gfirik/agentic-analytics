// EXPLAIN (agent-and-verifier §5). For each top finding: code states the observed change and its decomposition;
// the planner investigates with the fixed tools, then writes candidate explanations with causal grades and the
// alternatives it rejected. Its text is checked here before it enters the draft: placeholders must name known
// facts, extract ids must be ones it was shown, and document_supported needs a cited document.
// In small-model mode there is no tool loop: code runs one document search and the model fills a strict form.
import type { StoredDecomposition, StoredInsight } from "@agentic-analytics/analysis";
import type { ModelClient, ToolSet } from "@agentic-analytics/models";
import { type Citation, type Claim, type Fact, type Finding, findFreeNumerals, placeholders } from "@agentic-analytics/schema";
import { z } from "zod";
import { contributionDrivers, decompositionClaims, findingType, observedClaim, q, severity, topDrivers } from "./claims.ts";
import type { Extract } from "./extractor.ts";
import { type FactSheet, sheetFact } from "./factsheet.ts";
import { data, renderPrompt } from "./prompts.ts";
import type { Budget, ToolContext } from "./tools.ts";

const noNumerals = (s: string) => findFreeNumerals(s).length === 0;
const NUMERALS = "write numbers only as {{N…}} fact placeholders; no other digits except dates and quoted source text";
const Text = z.string().min(3).max(600).refine(noNumerals, NUMERALS);
const NO_PLACEHOLDERS = "no numbers or {{N…}} placeholders here; numbers belong in the explanations";
/** Titles, alternatives and reasons: plain words only. Numbers live in claims, where they are checked. */
const Plain = (max: number) =>
  z
    .string()
    .min(3)
    .max(max)
    .refine(noNumerals, NUMERALS)
    .refine((t) => placeholders(t).length === 0, NO_PLACEHOLDERS);
const Grade = z.enum(["observed", "correlated", "document_supported", "intervention_supported"]);

export const ExplainOutput = z.object({
  title: Plain(160),
  explanations: z
    .array(z.object({ text: Text, facts: z.array(z.string()).max(12), extract_ids: z.array(z.string()).max(5), causal_grade: Grade }))
    .max(4),
  alternatives_rejected: z.array(z.object({ explanation: Plain(600), reason: Plain(600) })).max(4),
  confidence: z.enum(["high", "medium", "low"]),
  confidence_reasons: z.array(Plain(600)).max(4),
});
export type ExplainOutput = z.infer<typeof ExplainOutput>;

/** Small-model form: pick, don't write. Code turns the picks into sentences. */
export const SmallExplainOutput = z.object({
  title: Plain(160),
  links: z.array(z.object({ extract_id: z.string(), causal_grade: z.enum(["correlated", "document_supported"]) })).max(3),
  confidence: z.enum(["high", "medium", "low"]),
});

export interface Dropped {
  readonly claim: string;
  readonly reason: string;
}

export interface Downgraded {
  readonly claim: string;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}

export interface ExplainResult {
  readonly findings: Finding[];
  readonly dropped: Dropped[];
  readonly downgraded: Downgraded[];
  /** Which top insight each finding explains (finding id → insight id). */
  readonly insightOf: Record<string, string>;
}

export interface ExplainOptions {
  readonly small: boolean;
  /** At most this many findings (5, or 3 in small-model mode). */
  readonly maxFindings: number;
  readonly log?: { info(msg: string, fields?: Record<string, unknown>): void; warn(msg: string, fields?: Record<string, unknown>): void };
  /** Called after each finding (done, total), e.g. to emit stage progress. */
  readonly onFinding?: (done: number, total: number) => Promise<void>;
}

const siteOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

const RANK: Record<string, number> = { observed: 0, correlated: 1, document_supported: 2, intervention_supported: 3 };

function citationOf(e: Extract): Citation {
  return { source_id: e.citation.source_id, quote: e.citation.quote };
}

/**
 * A model claim enters the draft only if every fact it names exists and every placeholder is listed (fixed up
 * here), every extract id is one it was shown, and its grade is backed: document_supported needs a document.
 */
function checkClaim(
  c: { text: string; facts: string[]; extract_ids: string[]; causal_grade: Claim["causal_grade"] },
  facts: ReadonlyMap<string, Fact>,
  extracts: ReadonlyMap<string, Extract>,
  dropped: Dropped[],
  downgraded: Downgraded[],
): Claim | undefined {
  const ids = [...new Set([...c.facts, ...placeholders(c.text)])];
  const unknownFact = ids.find((id) => !facts.has(id));
  if (unknownFact) {
    dropped.push({ claim: c.text, reason: `unknown fact ${unknownFact}` });
    return undefined;
  }
  const unknownExtract = c.extract_ids.find((id) => !extracts.has(id));
  if (unknownExtract) {
    dropped.push({ claim: c.text, reason: `unknown or quarantined extract ${unknownExtract}` });
    return undefined;
  }
  let grade = c.causal_grade ?? "correlated";
  if ((RANK[grade] ?? 0) >= (RANK.document_supported ?? 2) && c.extract_ids.length === 0) {
    downgraded.push({ claim: c.text, from: grade, to: "correlated", reason: "no source document cited" });
    grade = "correlated";
  }
  return {
    text: c.text,
    facts: ids,
    citations: c.extract_ids.map((id) => citationOf(extracts.get(id) as Extract)),
    causal_grade: grade,
    verified: false,
  };
}

/** Event words for a quality rate (refunds, returns, defects): what usually moves one is a supplier or quality change. */
export const RATE_EVENT_WORDS = "supplier switch quality defect complaint";
/** Event words for any other change: prices, orders paused or lost, launches. */
export const CHANGE_EVENT_WORDS = "price increase paused order lost customer launch";
const QUALITY_RATE = /refund|return|defect|complaint|churn/i;

/**
 * The one search small-model mode runs per finding (agent-and-verifier §8): the metric, the top member of each split,
 * the period and the change type's event words. The extractor keeps only what it judges relevant to this query; with
 * no event words it dropped "we switched our supplier" as unrelated to "Refund Rate 2026-06" (nightly run 2026-10-19:
 * no detected refund-rate change cited its cause), and a query naming only the channel missed the customer's email.
 */
export function smallModeQuery(
  def: { readonly id: string; readonly label?: string; readonly unit?: string },
  drivers: readonly string[],
  period: string,
): string {
  const rate = def.unit === "percent" && QUALITY_RATE.test(`${def.id} ${def.label ?? ""}`);
  const words = [def.label ?? def.id, ...drivers.slice(0, 3), period, rate ? RATE_EVENT_WORDS : CHANGE_EVENT_WORDS];
  // search_documents takes at most 200 characters: drop drivers from the end until the query fits.
  while (words.join(" ").length > 200 && words.length > 3) words.splice(words.length - 3, 1);
  return words.join(" ").slice(0, 200);
}

export async function explainFindings(
  ctx: ToolContext,
  tools: ToolSet,
  budget: Budget,
  model: ModelClient,
  top: readonly StoredInsight[],
  decompositions: readonly StoredDecomposition[],
  sheet: FactSheet,
  facts: () => Promise<Map<string, Fact>>,
  options: ExplainOptions,
): Promise<ExplainResult> {
  const findings: Finding[] = [];
  const dropped: Dropped[] = [];
  const downgraded: Downgraded[] = [];
  const insightOf: Record<string, string> = {};
  for (const insight of top.slice(0, options.maxFindings)) {
    budget.startFinding();
    const id = `F${findings.length + 1}`;
    const def = ctx.defs.find((d) => d.id === insight.metric);
    const ds = decompositions.filter((d) => d.insight === insight.id);
    const before = await facts();
    const observed = [observedClaim(insight, ctx.defs, before), ...decompositionClaims(ds, before)].filter(
      (c): c is Claim => c !== undefined,
    );
    const findingSheet = {
      ...sheet,
      insights: sheet.insights.filter((i) => i.id === insight.id),
      decompositions: sheet.decompositions.filter((d) => d.insight === insight.id),
    };
    const brief = data({
      id: insight.id,
      template: insight.template,
      metric: insight.metric,
      ...(insight.member ? { member: insight.member } : {}),
      period: insight.period,
      observed: observed.map((c) => c.text),
    });
    // By id, not by position: a source quarantined during this finding removes earlier extracts from the list.
    const known = new Set(ctx.found.extracts.map((e) => e.id));

    if (!options.small) {
      const run = await model.generateWithTools({
        role: "planner",
        system: renderPrompt("explain", { finding: brief, factsheet: data(findingSheet), budget: String(budget.perFinding) }),
        messages: [
          { role: "user", content: `Investigate finding ${insight.id} (${insight.template}, ${insight.metric}, ${insight.period}).` },
        ],
        tools,
        maxSteps: budget.perFinding,
      });
      // Tool errors went back to the planner as data; they are also logged so a failing tool is visible.
      for (const step of run.steps)
        for (const t of step.toolCalls) {
          const err =
            t.error ??
            (t.output && typeof t.output === "object" && "error" in t.output ? String((t.output as { error: unknown }).error) : undefined);
          if (err) options.log?.warn("tool call failed", { finding: id, tool: t.toolName, error: err });
        }
    } else {
      // Small models call tools unreliably (§8): code runs the one search that matters.
      const query = smallModeQuery(def ?? { id: insight.metric }, topDrivers(ds, before), insight.period);
      await (tools.search_documents as { execute(i: unknown): Promise<unknown> }).execute({ query });
    }
    const evidence = ctx.found.extracts.filter((e) => !known.has(e.id));
    const extracts = new Map(evidence.map((e) => [e.id, e]));
    const after = await facts();
    const newFacts = [...after.values()].filter((f) => !before.has(f.id)).map(sheetFact);
    const evidenceText = data({
      extracts: evidence.map((e) => ({
        id: e.id,
        kind: e.kind,
        // Web extracts show their site only (a URL path is attacker-controlled text) and are marked external.
        ...(e.external ? { site: siteOf(e.file), external: true } : { file: e.file }),
        date: e.date,
        actor: e.actor,
        text: e.text,
        quote: e.quote,
      })),
      new_facts: newFacts,
    });

    let claims: Claim[] = [...observed];
    let title: string;
    let confidence: Finding["confidence"] = insight.confidence;
    const reasons: string[] = [];
    if (!options.small) {
      const { object } = await model.generateObject({
        role: "planner",
        schema: ExplainOutput,
        system: renderPrompt("explain-write", { finding: brief, factsheet: data(findingSheet), evidence: evidenceText }),
        prompt: `Write the explanation for finding ${insight.id}.`,
      });
      title = object.title;
      for (const e of object.explanations) {
        const c = checkClaim({ ...e, causal_grade: e.causal_grade }, after, extracts, dropped, downgraded);
        if (c) claims.push(c);
      }
      for (const a of object.alternatives_rejected) reasons.push(`Considered and rejected: ${a.explanation} (${a.reason})`);
      reasons.push(...object.confidence_reasons);
      confidence = lower(confidence, object.confidence);
    } else {
      const { object } = await model.generateObject({
        role: "planner",
        schema: SmallExplainOutput,
        system: renderPrompt("explain-form", { finding: brief, factsheet: data(findingSheet), evidence: evidenceText }),
        prompt: `Fill the form for finding ${insight.id}: a title, and which extracts (by id) relate to the change.`,
      });
      title = object.title;
      for (const l of object.links) {
        const e = extracts.get(l.extract_id);
        const text = e ? `${q(e.file)} says: ${q(e.quote)}` : l.extract_id;
        const c = checkClaim(
          { text, facts: [], extract_ids: [l.extract_id], causal_grade: l.causal_grade },
          after,
          extracts,
          dropped,
          downgraded,
        );
        if (c) claims.push(c);
      }
      confidence = lower(confidence, object.confidence);
    }
    if (insight.notes.length) reasons.push(...insight.notes.filter(noNumerals));
    claims = claims.filter((c) => c.text.length > 0);
    const drivers = contributionDrivers(ds, after)
      ?.drivers.slice(0, 3)
      .map((d) => ({ ...d, label: q(d.label) }));
    const finding: Finding = {
      id,
      type: findingType(insight, def),
      severity: severity(insight.score),
      title,
      claims,
      ...(drivers?.length ? { drivers } : {}),
      method: ds[0]?.method ?? insight.template,
      confidence,
      confidence_reasons: reasons.length
        ? reasons
        : [`Detected by the ${insight.template.replace(/\.v\d+$/, "").replace(/_/g, " ")} test with ${insight.confidence} confidence.`],
      assumptions: [],
    };
    findings.push(finding);
    insightOf[id] = insight.id;
    await options.onFinding?.(findings.length, Math.min(top.length, options.maxFindings));
    options.log?.info("finding explained", { finding: id, insight: insight.id, claims: claims.length, extracts: evidence.length });
  }
  // A source quarantined by a later finding's search also takes back what earlier findings cited from it.
  const clean = withoutQuarantined(findings, ctx.found.quarantined);
  // Keep ids gap-free (F1, F2, …) and the finding → insight map in step when a finding was dropped.
  const renumbered = clean.findings.map((f, i) => ({ ...f, id: `F${i + 1}` }));
  const kept: Record<string, string> = {};
  clean.findings.forEach((f, i) => {
    const insight = insightOf[f.id];
    if (insight) kept[`F${i + 1}`] = insight;
  });
  return { findings: renumbered, dropped: [...dropped, ...clean.dropped], downgraded, insightOf: kept };
}

/** Drops claims citing a quarantined source (security §3: the whole source is excluded), recording each drop. */
export function withoutQuarantined(
  findings: readonly Finding[],
  quarantined: readonly string[],
): { findings: Finding[]; dropped: Dropped[] } {
  const bad = new Set(quarantined);
  const dropped: Dropped[] = [];
  const out = findings.map((f) => ({
    ...f,
    claims: f.claims.filter((c) => {
      const hit = c.citations.find((x) => bad.has(x.source_id));
      if (hit) dropped.push({ claim: c.text, reason: `source ${hit.source_id} quarantined (suspicious instructions)` });
      return !hit;
    }),
  }));
  // Every finding keeps its code-written observed claims, but a finding left with none is dropped too.
  return { findings: out.filter((f) => f.claims.length > 0), dropped };
}

const LEVEL = { low: 0, medium: 1, high: 2 } as const;
function lower(a: Finding["confidence"], b: Finding["confidence"]): Finding["confidence"] {
  return LEVEL[a] <= LEVEL[b] ? a : b;
}
