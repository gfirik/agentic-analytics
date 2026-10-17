// The small-model input budget for DECIDE (agent-and-verifier §8.1). Free tiers cap input tokens per minute (Groq:
// 7,000 for qwen/qwen3.8-27b), and a request over the cap is refused outright, so in small-model mode the whole
// DECIDE request (system prompt, findings, fact sheet, JSON Schema, prompt, retry feedback) must fit in 6,500
// estimated tokens. When it doesn't, the fact sheet and findings are trimmed in a fixed order, least informative
// first, until it fits. Trimming only removes or shortens what the model reads: every value it keeps is the fact's
// own (sheetFact), every fact id stays resolvable (DECIDE checks ids against the whole fact table, not the sheet),
// and facts the findings cite are never dropped. If the last step still doesn't fit, nothing is sent.
import { estimateObjectRequest, ModelError, type ObjectRequest } from "@agentic-analytics/models";
import { placeholders } from "@agentic-analytics/schema";
import type { FactSheet, SheetFact } from "./factsheet.ts";

/** Small-model mode's input budget, in estimated tokens: 500 under Groq's 7,000 ITPM free tier, for estimate error. */
export const SMALL_MODEL_INPUT_BUDGET = 6500;

/** Members of a contribution split kept by the `top_members` step (plus any member a finding cites). */
export const TOP_MEMBERS = 3;
/** Longest finding claim without placeholders (a quoted source) after the `short_quotes` step. */
export const QUOTE_MAX_CHARS = 160;

/** What DECIDE shows of a finding: its id, type, title and claim texts. */
export interface DecideFinding {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly claims: readonly string[];
}

export type TrimStep =
  | "decomposition_labels"
  | "top_members"
  | "short_quotes"
  | "uncited_decompositions"
  | "unused_metrics"
  | "insight_labels";

/** The trimming order (agent-and-verifier §8.1): each step applies on top of the ones before it. */
export const TRIM_STEPS: readonly TrimStep[] = [
  "decomposition_labels",
  "top_members",
  "short_quotes",
  "uncited_decompositions",
  "unused_metrics",
  "insight_labels",
];

type Facts = Record<string, SheetFact | Omit<SheetFact, "label">>;
type Sheet = Omit<FactSheet, "insights" | "decompositions"> & {
  insights: (Omit<FactSheet["insights"][number], "facts"> & { facts: Facts })[];
  decompositions: (Omit<FactSheet["decompositions"][number], "facts"> & { facts: Facts; omitted_members?: number })[];
};

const unlabel = (facts: Facts): Facts =>
  Object.fromEntries(Object.entries(facts).map(([role, f]) => [role, { id: f.id, value: f.value, unit: f.unit }]));

/** Keeps the `keep` members of a contribution split with the largest |change|, plus cited ones; other roles stay. */
function topMembers(facts: Facts, cited: ReadonlySet<string>, keep: number): { facts: Facts; omitted: number } {
  const members = new Map<string, { change: number; cited: boolean; order: number }>();
  for (const [role, f] of Object.entries(facts)) {
    const i = role.indexOf(":");
    if (i < 0) continue;
    const name = role.slice(i + 1);
    const m = members.get(name) ?? { change: 0, cited: false, order: members.size };
    if (role.startsWith("change:")) m.change = Math.abs(f.value);
    if (cited.has(f.id)) m.cited = true;
    members.set(name, m);
  }
  // Largest movement first; ties keep the split's own order, so the result never depends on map iteration.
  const ranked = [...members.entries()].sort((a, b) => b[1].change - a[1].change || a[1].order - b[1].order);
  const kept = new Set(ranked.filter(([, m], rank) => rank < keep || m.cited).map(([name]) => name));
  const out = Object.fromEntries(
    Object.entries(facts).filter(([role]) => {
      const i = role.indexOf(":");
      return i < 0 || kept.has(role.slice(i + 1));
    }),
  );
  return { facts: out, omitted: members.size - kept.size };
}

/**
 * The sheet and findings after the given trimming steps. Pure and deterministic. A fact counts as cited when a
 * finding's claim text names it (`{{N…}}`) or it is in `cites` (the claims' `facts` lists); cited facts are kept.
 */
export function trimDecideInput(
  sheet: FactSheet,
  findings: readonly DecideFinding[],
  steps: readonly TrimStep[],
  cites: readonly string[] = [],
): { sheet: Sheet; findings: DecideFinding[] } {
  const cited = new Set([...cites, ...findings.flatMap((f) => f.claims.flatMap((c) => placeholders(c)))]);
  const has = (s: TrimStep) => steps.includes(s);
  let out: Sheet = {
    ...sheet,
    insights: sheet.insights.map((i) => ({ ...i, facts: { ...i.facts } })),
    decompositions: sheet.decompositions.map((d) => ({ ...d, facts: { ...d.facts } })),
  };
  if (has("decomposition_labels")) out.decompositions = out.decompositions.map((d) => ({ ...d, facts: unlabel(d.facts) }));
  if (has("top_members"))
    out.decompositions = out.decompositions.map((d) => {
      if (d.method !== "contribution.v1") return d;
      const t = topMembers(d.facts, cited, TOP_MEMBERS);
      return t.omitted ? { ...d, facts: t.facts, omitted_members: t.omitted } : d;
    });
  if (has("uncited_decompositions"))
    out.decompositions = out.decompositions.filter((d) => Object.values(d.facts).some((f) => cited.has(f.id)));
  if (has("unused_metrics")) {
    const used = new Set(out.insights.map((i) => i.metric));
    out = { ...out, metrics: out.metrics.filter((m) => used.has(m.id)) };
  }
  if (has("insight_labels")) out.insights = out.insights.map((i) => ({ ...i, facts: unlabel(i.facts) }));
  const shorten = (c: string) =>
    has("short_quotes") && placeholders(c).length === 0 && [...c].length > QUOTE_MAX_CHARS
      ? `${[...c].slice(0, QUOTE_MAX_CHARS - 1).join("")}…`
      : c;
  return { sheet: out, findings: findings.map((f) => ({ ...f, claims: f.claims.map(shorten) })) };
}

/** A request with its size: what DECIDE sends, the estimate, and the trimming steps applied. */
export interface BudgetedRequest extends ObjectRequest {
  readonly estimate: number;
  readonly untrimmed: number;
  readonly steps: readonly TrimStep[];
}

/**
 * The smallest prefix of TRIM_STEPS whose request fits `budget` (no steps when it fits as is). Without a budget the
 * request is built untrimmed. Over budget after every step: INPUT_TOO_LARGE, and nothing is sent.
 */
export function fitToBudget(
  build: (sheet: Sheet, findings: readonly DecideFinding[]) => ObjectRequest,
  sheet: FactSheet,
  findings: readonly DecideFinding[],
  budget: number | undefined,
  cites: readonly string[] = [],
): BudgetedRequest {
  const full = build(sheet as Sheet, findings);
  const untrimmed = estimateObjectRequest(full);
  if (budget === undefined || untrimmed <= budget) return { ...full, estimate: untrimmed, untrimmed, steps: [] };
  let last = untrimmed;
  for (let n = 1; n <= TRIM_STEPS.length; n++) {
    const steps = TRIM_STEPS.slice(0, n);
    const t = trimDecideInput(sheet, findings, steps, cites);
    const req = build(t.sheet, t.findings);
    const estimate = estimateObjectRequest(req);
    if (estimate <= budget) return { ...req, estimate, untrimmed, steps };
    last = estimate;
  }
  throw new ModelError(
    "INPUT_TOO_LARGE",
    `the DECIDE request is about ${untrimmed} input tokens (estimated), still ${last} after every trimming step, over the input budget of ${budget}; it was not sent`,
  );
}
