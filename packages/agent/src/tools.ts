// The planner's fixed tools (agent-and-verifier §3; AGENTS.md §2.6: no code execution). Each tool validates its
// input with Zod, runs deterministic engine code, and returns compact JSON. Numbers come back as fact ids with
// values; document text comes back only as extracts from the quarantined extractor. A shared budget caps the
// calls (25 per job, 8 per finding; halved in small-model mode); a call over budget returns an error instead.
import {
  benchmarkFacts,
  drillDown,
  parseQuotedRange,
  readFacts,
  type ScenarioRequest,
  type StoredDecomposition,
  type StoredInsight,
  scenarioFacts,
} from "@agentic-analytics/analysis";
import type { Catalog, Grain } from "@agentic-analytics/metrics";
import type { ModelClient, ToolDef, ToolSet } from "@agentic-analytics/models";
import { type Embedder, type Reranker, searchDocuments } from "@agentic-analytics/retrieval";
import type { Fact, MetricDef } from "@agentic-analytics/schema";
import type { Workspace } from "@agentic-analytics/store";
import { z } from "zod";
import { type Extract, extractFromHits } from "./extractor.ts";
import { type SheetFact, sheetFact } from "./factsheet.ts";
import { searchAndStore, type WebLane } from "./web.ts";
import { withheld, withheldKeys } from "./withhold.ts";

export class Budget {
  private usedTotal = 0;
  private usedFinding = 0;
  constructor(
    readonly total: number,
    readonly perFinding: number,
  ) {}
  /** Starts the per-finding count for the next finding. */
  startFinding(): void {
    this.usedFinding = 0;
  }
  /** Takes one call from the budget, or returns why it can't. */
  take(): string | undefined {
    if (this.usedTotal >= this.total) return `tool budget exhausted (${this.total} calls per job)`;
    if (this.usedFinding >= this.perFinding) return `tool budget for this finding exhausted (${this.perFinding} calls)`;
    this.usedTotal++;
    this.usedFinding++;
    return undefined;
  }
  get used(): number {
    return this.usedTotal;
  }
}

export interface OpenQuestionDraft {
  readonly question: string;
  readonly why_it_matters: string;
}

export interface ToolContext {
  readonly ws: Workspace;
  readonly defs: readonly MetricDef[];
  readonly catalog: Catalog;
  readonly range: { readonly from: string; readonly to: string; readonly grain: Grain };
  readonly insights: readonly StoredInsight[];
  readonly decompositions: readonly StoredDecomposition[];
  readonly model: ModelClient;
  readonly embedder: Embedder;
  readonly reranker?: Reranker;
  /** The web lane, when the job has `--web` and a search provider (agent-and-verifier §4). */
  readonly webLane?: WebLane;
  /** Collected across tools: extracts found, quarantined sources, open questions asked. */
  readonly found: {
    extracts: Extract[];
    quarantined: string[];
    questions: OpenQuestionDraft[];
    scenarios: Record<string, unknown>[];
    /** Queries actually sent to the search provider (after sanitizing). */
    webQueries?: string[];
  };
}

type ToolResult = Record<string, unknown>;

function tool<I>(
  description: string,
  inputSchema: z.ZodType<I>,
  budget: Budget,
  run: (input: I) => Promise<ToolResult>,
): ToolDef<I, ToolResult> {
  return {
    description,
    inputSchema,
    async execute(input) {
      const over = budget.take();
      if (over) return { error: over };
      try {
        return await run(input);
      } catch (err) {
        // Typed engine errors about the request (unknown fact, bad slice, parameter out of range) go back to the
        // planner as data so it can correct itself; anything untyped is an engine failure and stops the stage.
        if (!(err instanceof Error && "code" in err && typeof err.code === "string")) throw err;
        // Screened like any other text the planner reads: a future message could quote a column or member name.
        return { error: withheld(`${err.code}: ${err.message}`) };
      }
    },
  };
}

const facts = (list: readonly Fact[]): SheetFact[] => list.map(sheetFact);

const ScenarioInput = z.discriminatedUnion("type", [
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

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

export function buildTools(ctx: ToolContext, budget: Budget): ToolSet {
  const get_facts = tool(
    "Look up computed facts by id, or by a word in their label. Returns id, value, unit and label.",
    z.object({ ids: z.array(z.string()).max(30).optional(), query: z.string().max(100).optional() }),
    budget,
    async ({ ids, query }) => {
      const all = await readFacts(ctx.ws);
      // Matched on the label the planner may see, so a query can't probe text that was withheld from it.
      const hit = all.filter((f) =>
        ids ? ids.includes(f.id) : query ? withheld(f.label).toLowerCase().includes(query.toLowerCase()) : false,
      );
      return { facts: facts(hit.slice(0, 30)) };
    },
  );

  const drill_down = tool(
    "Run the contribution template on one slice: how each member of a dimension contributed to a metric's change from the previous period to `period`. Returns new fact ids.",
    z.object({ metric_id: z.string(), period: z.string(), dimension: z.string(), filters: z.record(z.string(), z.string()).optional() }),
    budget,
    async ({ metric_id, period, dimension, filters }) => {
      if (filters && Object.keys(filters).length)
        return { error: "filters are not supported in v0.1; drill down by one dimension at a time" };
      const r = await drillDown(ctx.ws, ctx.defs, ctx.catalog, { metric: metric_id, period, dimension, range: ctx.range });
      const byId = new Map(r.newFacts.map((f) => [f.id, f]));
      return {
        metric: r.metric,
        dimension: r.dimension,
        from: r.before,
        to: r.after,
        facts: withheldKeys(
          Object.fromEntries(Object.entries(r.facts).flatMap(([k, id]) => (byId.has(id) ? [[k, sheetFact(byId.get(id) as Fact)]] : []))),
        ),
      };
    },
  );

  const decompose = tool(
    "Return the decompositions (contribution, pvm, ratemix) computed for the material change a fact belongs to.",
    z.object({ fact_id: z.string(), method: z.enum(["contribution", "pvm", "ratemix"]) }),
    budget,
    async ({ fact_id, method }) => {
      const insight = ctx.insights.find((i) => Object.values(i.facts).includes(fact_id));
      if (!insight) return { error: `fact ${fact_id} is not part of a material change` };
      const all = new Map((await readFacts(ctx.ws)).map((f) => [f.id, f]));
      const list = ctx.decompositions.filter((d) => d.insight === insight.id && d.method === `${method}.v1`);
      if (!list.length) return { error: `no ${method} decomposition for ${insight.id}; try drill_down` };
      return {
        insight: insight.id,
        decompositions: list.map((d) => ({
          id: d.id,
          dimension: withheld(d.dimension),
          facts: withheldKeys(
            Object.fromEntries(Object.entries(d.facts).flatMap(([k, id]) => (all.has(id) ? [[k, sheetFact(all.get(id) as Fact)]] : []))),
          ),
        })),
      };
    },
  );

  const search_documents = tool(
    "Search the job's documents and emails. Returns extracts (event, statement, exact quote, file), never raw text.",
    z.object({
      query: z.string().min(2).max(200),
      sources: z.array(z.string()).max(20).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
    budget,
    async ({ query, sources, from, to }) => {
      const r = await searchDocuments(ctx.ws, query, {
        embedder: ctx.embedder,
        ...(ctx.reranker ? { reranker: ctx.reranker } : {}),
        ...(sources ? { sources } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      const x = await extractFromHits(ctx.ws, ctx.model, r.hits, `Find events and statements relevant to: ${query}`);
      ctx.found.extracts.push(...x.extracts);
      for (const q of x.quarantined) if (!ctx.found.quarantined.includes(q)) ctx.found.quarantined.push(q);
      // A source quarantined now also withdraws what was found from it earlier in the job.
      for (let i = ctx.found.extracts.length - 1; i >= 0; i--)
        if (ctx.found.quarantined.includes(ctx.found.extracts[i]?.citation.source_id ?? "")) ctx.found.extracts.splice(i, 1);
      return {
        extracts: x.extracts.map((e) => ({
          id: e.id,
          kind: e.kind,
          // A file name can come from a third party (an email attachment): screened like the rest.
          file: withheld(e.file),
          ...(e.date ? { date: e.date } : {}),
          ...(e.actor ? { actor: e.actor } : {}),
          text: e.text,
          quote: e.quote,
        })),
        ...(x.quarantined.length ? { note: "some sources were quarantined for suspicious instructions" } : {}),
        ...(r.degraded.length ? { degraded: r.degraded } : {}),
      };
    },
  );

  const search_web = tool(
    "Search the web for public context such as industry benchmarks. The query is sanitized first (no names, no numbers from the data). Returns external extracts, labelled external.",
    z.object({ query: z.string().min(3).max(200) }),
    budget,
    async ({ query }) => {
      if (!ctx.webLane) return { error: "web search is off for this job (enable it with --web)" };
      const { result, hits } = await searchAndStore(ctx.ws, ctx.webLane, query);
      if (!ctx.found.webQueries) ctx.found.webQueries = [];
      ctx.found.webQueries.push(result.query);
      const x = await extractFromHits(ctx.ws, ctx.model, hits, `Find industry benchmarks and statements relevant to: ${result.query}`, {
        external: true,
      });
      ctx.found.extracts.push(...x.extracts);
      for (const q of x.quarantined) if (!ctx.found.quarantined.includes(q)) ctx.found.quarantined.push(q);
      return {
        query_sent: result.query,
        external: true,
        // The site only: a result URL's path is attacker-controlled text (security §2).
        extracts: x.extracts.map((e) => ({ id: e.id, kind: e.kind, site: hostOf(e.file), text: e.text, quote: e.quote, external: true })),
        ...(result.skipped.length ? { skipped: result.skipped.map((s) => s.code) } : {}),
      };
    },
  );

  const compare_benchmark = tool(
    "Compare a fact with a range quoted in an external extract (e.g. an industry rate). The engine reads the range from the quote and computes the gap; the range facts are labelled external.",
    z.object({ fact_id: z.string(), extract_id: z.string() }),
    budget,
    async ({ fact_id, extract_id }) => {
      const e = ctx.found.extracts.find((x) => x.id === extract_id);
      if (!e?.external) return { error: `${extract_id} is not an external extract from search_web` };
      const range = parseQuotedRange(e.quote);
      if (!range) return { error: `no number range in the quote of ${extract_id}` };
      const r = await benchmarkFacts(ctx.ws, ctx.defs, ctx.catalog, ctx.range.grain, fact_id, {
        range,
        source_id: e.citation.source_id,
        quote: e.quote,
        label: e.topic ?? e.text.slice(0, 60),
      });
      const byId = new Map(r.newFacts.map((f) => [f.id, f]));
      return {
        external: true,
        low: sheetFact(byId.get(r.low) as Fact),
        high: sheetFact(byId.get(r.high) as Fact),
        gap: sheetFact(byId.get(r.gap) as Fact),
      };
    },
  );

  const propose_scenario = tool(
    "Compute an impact range for an action in code. Give the scenario type, the fact ids it starts from and the parameter range; `because` lists fact ids that justify the parameters.",
    z.object({ scenario: ScenarioInput, because: z.array(z.string()).max(10) }),
    budget,
    async ({ scenario, because }) => {
      const r = await scenarioFacts(ctx.ws, ctx.defs, ctx.catalog, ctx.range.grain, scenario as ScenarioRequest, because);
      const byId = new Map(r.newFacts.map((f) => [f.id, f]));
      const out = {
        method: r.method,
        formula: r.formula,
        low: sheetFact(byId.get(r.low) as Fact),
        high: sheetFact(byId.get(r.high) as Fact),
        params: r.params,
      };
      ctx.found.scenarios.push({ scenario, because, ...out });
      return out;
    },
  );

  const ask_user = tool(
    "Record an open question for the user (non-blocking): something the data can't answer that would change a conclusion.",
    z.object({ question: z.string().min(5).max(300), why_it_matters: z.string().min(5).max(300) }),
    budget,
    async (q) => {
      ctx.found.questions.push(q);
      return { recorded: true };
    },
  );

  return {
    get_facts,
    drill_down,
    decompose,
    search_documents,
    search_web,
    compare_benchmark,
    propose_scenario,
    ask_user,
  } as unknown as ToolSet;
}
