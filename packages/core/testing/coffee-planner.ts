// A scripted FakeModel for coffee-roaster-v1 (no network): what a good planner and extractor would do on this
// dataset. Entries are functions of the prompt, because the fact and extract ids only exist at run time; the
// script reads them from the fact sheet and evidence the engine put in the prompt, exactly as a model would.
// It also slips in mistakes (an unknown fact id, a candidate action with no finding) so the checks are exercised.
import { FakeModel, type FakeRequest, type FakeStep } from "@agentic-analytics/models/testing";

interface SheetFact {
  id: string;
  value: number;
  label: string;
}
interface Sheet {
  insights: { id: string; metric: string; template: string; period: string; member?: unknown; facts: Record<string, SheetFact> }[];
  decompositions: { insight: string; method: string; dimension: string; facts: Record<string, SheetFact> }[];
}
interface Evidence {
  extracts: { id: string; quote: string }[];
}

// The last occurrence of the opening tag: the prompts' rules mention "<facts>" and "<evidence>" before the blocks.
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

const QUOTES: { match: string; out: unknown }[] = [
  {
    match: "pausing our standing order",
    out: {
      events: [
        {
          date: "12 Apr 2026",
          actor: "Hotel Group",
          what: "paused its standing order after the new price list",
          quote: "After the new price list we are pausing our standing order while we compare suppliers.",
        },
      ],
      statements: [],
      suspicious_instructions: false,
    },
  },
  {
    match: "Wholesale prices increase 12%",
    out: {
      events: [{ date: "15 March 2026", what: "wholesale prices went up", quote: "Wholesale prices increase 12% from 15 March 2026." }],
      statements: [],
      suspicious_instructions: false,
    },
  },
  {
    match: "new packaging supplier",
    out: {
      events: [
        { date: "28 April", what: "switched to a new packaging supplier", quote: "Switched to the new packaging supplier on 28 April." },
      ],
      statements: [],
      suspicious_instructions: false,
    },
  },
];

function extract(r: FakeRequest): unknown {
  const doc = r.prompt.slice(r.prompt.indexOf(">") + 1, r.prompt.lastIndexOf("</document>"));
  return QUOTES.find((q) => doc.includes(q.match))?.out ?? { events: [], statements: [], suspicious_instructions: false };
}

function investigate(r: FakeRequest): FakeStep[] {
  const m = /\(([\w.]+), ([\w]+), ([\d-]+)\)/.exec(r.prompt);
  const metric = m?.[2] ?? "";
  const period = m?.[3] ?? "";
  if (metric.includes("revenue") && !metric.includes("retail"))
    return [
      { toolCalls: [{ toolName: "search_documents", input: { query: "wholesale price increase standing order paused" } }] },
      { toolCalls: [{ toolName: "drill_down", input: { metric_id: "revenue", period, dimension: "customer" } }] },
      { text: "Investigation done." },
    ];
  if (metric.includes("refund"))
    return [{ toolCalls: [{ toolName: "search_documents", input: { query: "packaging supplier switch valve bags" } }] }, { text: "Done." }];
  return [{ toolCalls: [{ toolName: "get_facts", input: { query: metric } }] }, { text: "Nothing more to check." }];
}

function explanation(r: FakeRequest, small: boolean): unknown {
  const finding = json<{ metric?: string; member?: unknown }>(between(r.system, "Finding:", "\n"), {});
  if (finding.member) return small ? { title: "A change for one member", links: [], confidence: "medium" } : generic(finding.metric ?? "");
  const evidence = json<Evidence>(between(r.system, "<evidence>", "</evidence>"), { extracts: [] });
  const find = (s: string) => evidence.extracts.find((e) => e.quote.includes(s));
  const paused = find("pausing our standing order");
  const price = find("Wholesale prices increase");
  const packaging = find("packaging supplier");
  const metric = finding.metric ?? "";
  if (small)
    return {
      title:
        packaging && metric.includes("refund")
          ? "Refund rate rose after the packaging switch"
          : paused
            ? "Revenue fell as a hotel paused its wholesale order"
            : `A change in ${metric.replace(/_/g, " ")}`,
      links: [
        ...(paused && (metric === "revenue" || metric === "wholesale_revenue")
          ? [{ extract_id: paused.id, causal_grade: "document_supported" }]
          : []),
        ...(packaging && metric.includes("refund") ? [{ extract_id: packaging.id, causal_grade: "correlated" }] : []),
      ],
      confidence: "medium",
    };
  if (metric.includes("refund"))
    return {
      title: "Refund rate rose after the packaging supplier switch",
      explanations: packaging
        ? [
            {
              text: "Refunds started rising after the switch to the new packaging supplier at the end of April.",
              facts: [],
              extract_ids: [packaging.id],
              causal_grade: "correlated",
            },
          ]
        : [],
      alternatives_rejected: [{ explanation: "A change in the customer mix", reason: "the rate rose within the large segments too" }],
      confidence: "medium",
      confidence_reasons: ["The timing matches the supplier switch, but no document links them directly."],
    };
  if (metric === "revenue" || metric === "wholesale_revenue")
    return {
      title: metric === "revenue" ? "Revenue fell after March, driven by wholesale" : "Wholesale revenue fell sharply after March",
      explanations: [
        ...(paused
          ? [
              {
                text: "The hotel customer paused its standing order because of the new price list.",
                facts: [],
                extract_ids: [paused.id],
                causal_grade: "document_supported",
              },
            ]
          : []),
        ...(price
          ? [
              {
                text: "The wholesale price increase took effect shortly before the drop.",
                facts: [],
                extract_ids: [price.id],
                causal_grade: "correlated",
              },
            ]
          : []),
        // A mistake a model makes: a fact id that doesn't exist. The engine must drop this claim.
        { text: "Wholesale also lost {{N99999}} in May.", facts: ["N99999"], extract_ids: [], causal_grade: "observed" },
        // Causal wording claimed with no document: must be downgraded.
        { text: "The drop was caused by the price increase.", facts: [], extract_ids: [], causal_grade: "document_supported" },
      ],
      alternatives_rejected: [{ explanation: "Weaker retail demand", reason: "retail revenue grew over the same months" }],
      confidence: "high",
      confidence_reasons: ["One customer's order explains most of the drop, and the customer's email states why."],
    };
  return generic(metric);
}

function generic(metric: string): unknown {
  return {
    title: `A change in ${metric.replace(/_/g, " ")}`,
    explanations: [],
    alternatives_rejected: [],
    confidence: "medium",
    confidence_reasons: ["No document explains this change."],
  };
}

function candidates(r: FakeRequest): unknown {
  const sheet = json<Sheet>(between(r.system, "<facts>", "</facts>"), { insights: [], decompositions: [] });
  const findings = json<{ id: string; claims: string[] }[]>(between(r.system, "<findings>", "</findings>"), []);
  const findingFor = (metric: string) =>
    findings.find((f) => {
      const ids = new Set(f.claims.flatMap((c) => [...c.matchAll(/\{\{(N\d+)\}\}/g)].map((m) => m[1])));
      return sheet.insights.some((i) => i.metric === metric && !i.member && Object.values(i.facts).some((x) => ids.has(x.id)));
    })?.id;
  const revenue = sheet.insights.find((i) => i.metric === "revenue" && !i.member);
  const refund = sheet.insights.find((i) => i.metric === "refund_rate" && !i.member);
  const lost = sheet.decompositions.find((d) => d.facts["change:wholesale"])?.facts["change:wholesale"];
  const share = sheet.decompositions.find((d) => d.facts["share:wholesale"])?.facts["share:wholesale"];
  const out: unknown[] = [];
  const fRevenue = findingFor("revenue");
  const fRefund = findingFor("refund_rate");
  if (revenue && lost && fRevenue && share)
    out.push({
      action: "Offer wholesale accounts a volume-tier discount to win back paused standing orders",
      because: [fRevenue],
      scenario: { type: "recover_share", lost: lost.id, low: 0.5, high: 0.9, discount: 0.06 },
      justified_by: [],
      rationale: { text: `Wholesale accounts for {{${share.id}}} of the revenue drop.`, facts: [share.id], extract_ids: [] },
      effort: "medium",
      risk: "The discount lowers the margin on every recovered order.",
      confidence: "medium",
      horizon: "next quarter",
      check: { metric_id: "revenue", comparator: ">=", threshold: revenue.facts.before?.id ?? "", by: "2026-09-30" },
      not_advised: "Do not cut retail prices: retail revenue is growing.",
    });
  if (refund && revenue && fRefund)
    out.push({
      action: "Return to the previous packaging supplier, or fix the new valve bags",
      because: [fRefund],
      scenario: {
        type: "remove_excess_rate",
        current: refund.facts.latest?.id ?? "",
        baseline: refund.facts.before?.id ?? "",
        base: revenue.facts.latest?.id ?? revenue.facts.after?.id ?? "",
        low: 0.5,
        high: 0.9,
      },
      justified_by: [],
      rationale: { text: "The refund rate started rising after the supplier switch.", facts: [], extract_ids: [] },
      effort: "low",
      risk: "The old supplier may cost more per unit.",
      confidence: "medium",
      horizon: "next two months",
      check: { metric_id: "refund_rate", comparator: "<=", threshold: refund.facts.before?.id ?? "", by: "2026-08-31" },
    });
  // A candidate tied to no finding: the engine must drop it.
  out.push({
    action: "Open a second shop",
    because: ["F99"],
    scenario: { type: "price_change", revenue: revenue?.facts.after?.id ?? "N1", low: 0, high: 0.1 },
    justified_by: [],
    rationale: { text: "More shops sell more coffee.", facts: [], extract_ids: [] },
    effort: "high",
    risk: "Large investment.",
    confidence: "low",
    horizon: "next year",
    check: { metric_id: "revenue", comparator: ">=", threshold: revenue?.facts.after?.id ?? "N1", by: "2027-06-30" },
  });
  return { candidates: out };
}

function headline(r: FakeRequest): unknown {
  const findings = json<{ title: string; claims: string[] }[]>(between(r.system, "<findings>", "</findings>"), []);
  const first = findings[0];
  const id = first?.claims.flatMap((c) => [...c.matchAll(/\{\{(N\d+)\}\}/g)].map((m) => m[1]))[2];
  return { headline: `${first?.title ?? "Revenue fell"}${id ? ` (a change of {{${id}}})` : ""}.` };
}

/** The scripted model for a full coffee-roaster job (normal or small-model mode). */
export function coffeePlanner(options: { small?: boolean } = {}): FakeModel {
  const small = options.small === true;
  return new FakeModel([
    { role: "extractor", match: "<document", repeat: true, object: extract },
    { role: "planner", match: "Investigate finding", repeat: true, steps: investigate },
    { role: "planner", match: /Write the explanation|Fill the form/, repeat: true, object: (r: FakeRequest) => explanation(r, small) },
    { role: "planner", match: "Propose the candidate actions", repeat: true, object: candidates },
    { role: "planner", match: "Write the headline", repeat: true, object: headline },
  ]);
}
