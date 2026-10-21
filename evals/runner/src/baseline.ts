// The "baseline" scripted model (no LLM): a heuristic planner, extractor and judge that work on any generated
// dataset, so the whole harness runs end to end with FakeModel (docs/EVALS.md §3 smoke suite). It reads only what a
// model would see in its prompts, but its keyword rules were written knowing the generator's document templates,
// so its cause and action scores are optimistic. It checks plumbing, not model quality; RESULTS.md says so.
import { FakeModel, type FakeRequest } from "@agentic-analytics/models/testing";

interface SheetFact {
  readonly id: string;
  readonly value: number;
  readonly label: string;
}
interface Sheet {
  readonly insights: { id: string; metric: string; member?: unknown; facts: Record<string, SheetFact> }[];
  readonly decompositions: { insight: string; method: string; dimension: string; facts: Record<string, SheetFact> }[];
}

const between = (text: string, open: string, close: string): string => {
  const i = text.lastIndexOf(open);
  const j = text.indexOf(close, i + open.length);
  return i >= 0 && j > i ? text.slice(i + open.length, j).trim() : "";
};
const json = <T>(text: string, fallback: T): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

const EVENT = /\b(paus\w*|stop\w*|cancel\w*|switch\w*|launch\w*|increase\w*|rais\w*|replac\w*|repaint\w*|lost|left)\b/i;
const BECAUSE = /\b(after|because|due to|since|as a result)\b/i;
const RATE = /refund|return|defect|complaint|churn/i;

/** Sentences that read as dated events, quoted exactly from the document. */
function extract(r: FakeRequest): unknown {
  const doc = r.prompt.slice(r.prompt.indexOf(">") + 1, r.prompt.lastIndexOf("</document>"));
  const sentences = doc.match(/[^.!?\n]+[.!?]/g) ?? [];
  const events = sentences
    .map((s) => s.trim())
    .filter((s) => s.length > 12 && s.length < 280 && EVENT.test(s))
    .slice(0, 4)
    .map((s) => ({ what: s.replace(/\.$/, "").toLowerCase(), quote: s }));
  return { events, statements: [], suspicious_instructions: false };
}

function investigate(r: FakeRequest) {
  const metric = /\(([\w.]+), ([\w]+), ([\d-]+)\)/.exec(r.prompt)?.[2] ?? "";
  const query = RATE.test(metric) ? "supplier switch quality packaging" : "price increase paused order launched";
  return [{ toolCalls: [{ toolName: "search_documents", input: { query } }] }, { text: "Done." }];
}

/** Links the extracts that read like causes of this kind of change; a stated reason is document-supported. */
function explanation(r: FakeRequest, small: boolean): unknown {
  const finding = json<{ metric?: string; member?: unknown }>(between(r.system, "Finding:", "\n"), {});
  const metric = finding.metric ?? "";
  const evidence = json<{ extracts: { id: string; quote: string }[] }>(between(r.system, "<evidence>", "</evidence>"), { extracts: [] });
  const relevant = evidence.extracts.filter((e) =>
    RATE.test(metric) ? /supplier|switch/i.test(e.quote) : /paus|launch|replac|cancel|stop/i.test(e.quote),
  );
  const grade = (q: string) => (BECAUSE.test(q) && /paus|cancel|stop/i.test(q) ? "document_supported" : "correlated");
  const title = `A change in ${metric.replace(/_/g, " ")}`;
  if (small)
    return { title, links: relevant.slice(0, 2).map((e) => ({ extract_id: e.id, causal_grade: grade(e.quote) })), confidence: "medium" };
  return {
    title,
    explanations: relevant.slice(0, 2).map((e) => ({
      // Source text goes in quotation marks: digits in it ("250g") are allowed only as an exact quote.
      text: grade(e.quote) === "document_supported" ? `A customer wrote: “${e.quote}”` : `Around the same time: “${e.quote}”`,
      facts: [],
      extract_ids: [e.id],
      causal_grade: grade(e.quote),
    })),
    alternatives_rejected: [],
    confidence: "medium",
    confidence_reasons: [relevant.length ? "A document mentions an event at the time of the change." : "No document explains this change."],
  };
}

/** Recover a lost member's revenue, or bring an elevated rate back to its baseline. */
function candidates(r: FakeRequest): unknown {
  const sheet = json<Sheet>(between(r.system, "<facts>", "</facts>"), { insights: [], decompositions: [] });
  const findings = json<{ id: string; claims: string[] }[]>(between(r.system, "<findings>", "</findings>"), []);
  const by = /a date after (\d{4}-\d{2}-\d{2})/.exec(r.system)?.[1] ?? "2026-06-30";
  const later = (months: number) => {
    const d = new Date(`${by}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0, 10);
  };
  const findingOf = (insight: { facts: Record<string, SheetFact> }) => {
    const ids = new Set(Object.values(insight.facts).map((f) => f.id));
    return findings.find((f) => f.claims.some((c) => [...c.matchAll(/\{\{(N\d+)\}\}/g)].some((m) => ids.has(m[1] as string))))?.id;
  };
  const base = sheet.insights.find((i) => i.metric === "revenue" && !i.member);
  const out: unknown[] = [];
  for (const ins of sheet.insights.filter((i) => !i.member)) {
    const f = findingOf(ins);
    if (!f) continue;
    if (RATE.test(ins.metric) && ins.facts.latest && ins.facts.before && base?.facts.latest) {
      out.push({
        action: `Bring ${ins.metric.replace(/_/g, " ")} back to its earlier level`,
        because: [f],
        scenario: {
          type: "remove_excess_rate",
          current: ins.facts.latest.id,
          baseline: ins.facts.before.id,
          base: base.facts.latest.id,
          low: 0.5,
          high: 0.9,
        },
        justified_by: [],
        rationale: { text: `${ins.metric.replace(/_/g, " ")} rose above its earlier level.`, facts: [], extract_ids: [] },
        effort: "low",
        risk: "The fix may cost more per unit.",
        confidence: "medium",
        horizon: "next quarter",
        check: { metric_id: ins.metric, comparator: "<=", threshold: ins.facts.before.id, by: later(3) },
      });
      continue;
    }
    const lost = sheet.decompositions
      .filter((d) => d.insight === ins.id)
      .flatMap((d) => Object.entries(d.facts).filter(([k, v]) => k.startsWith("change:") && v.value < 0))
      .sort((x, y) => x[1].value - y[1].value)[0];
    if (lost && ins.facts.before)
      out.push({
        action: `Win back “${lost[0].slice("change:".length)}”`,
        because: [f],
        scenario: { type: "recover_share", lost: lost[1].id, low: 0.3, high: 0.7, discount: 0.05 },
        justified_by: [],
        rationale: { text: `“${lost[0].slice("change:".length)}” accounts for most of the drop.`, facts: [], extract_ids: [] },
        effort: "medium",
        risk: "A discount lowers the margin on recovered orders.",
        confidence: "medium",
        horizon: "next quarter",
        check: { metric_id: ins.metric, comparator: ">=", threshold: ins.facts.before.id, by: later(3) },
      });
  }
  return { candidates: out };
}

function headline(r: FakeRequest): unknown {
  const findings = json<{ title: string }[]>(between(r.system, "<findings>", "</findings>"), []);
  return { headline: findings[0]?.title ?? "No material changes were found in this period." };
}

/** Supported when the claim and its excerpts share at least two content words. */
function judge(r: FakeRequest): unknown {
  const words = (t: string) => new Set(t.toLowerCase().match(/\p{L}{5,}/gu) ?? []);
  const a = words(between(r.system, "<claim>", "</claim>"));
  return { supported: [...words(between(r.system, "<sources>", "</sources>"))].filter((w) => a.has(w)).length >= 2 };
}

/**
 * The baseline scripted model for any generated dataset (normal or small-model mode). With `drafts`, the metric-draft
 * request answers with those proposals (a real model's drafts, kept by an earlier run): `aa eval --replay-drafts`
 * measures detection, ranking and the findings cap under real metrics, with no model call.
 */
export function baselineModel(options: { small?: boolean; drafts?: readonly unknown[] } = {}): FakeModel {
  const small = options.small === true;
  return new FakeModel([
    ...(options.drafts
      ? [
          {
            role: "extractor" as const,
            match: "Propose metric definitions for this data.",
            repeat: true,
            object: { metrics: options.drafts },
          },
        ]
      : []),
    { role: "extractor", match: "<document", repeat: true, object: extract },
    { role: "planner", match: "Investigate finding", repeat: true, steps: investigate },
    { role: "planner", match: /Write the explanation|Fill the form/, repeat: true, object: (r: FakeRequest) => explanation(r, small) },
    { role: "planner", match: "Propose the candidate actions", repeat: true, object: candidates },
    { role: "planner", match: "Write the headline", repeat: true, object: headline },
    { role: "judge", repeat: true, object: judge },
  ]);
}
