// The stage flows (learn-data.ts): each Learn page's inputs → steps → outputs diagram, assembled from the recorded data
// (no new numbers; values are the recorded ones or fact ids).
import type { Flow, LearnData } from "../../src/components/learn/types.ts";
import { need, short } from "./shared.ts";

const item = (label: string, value?: string | number, fact?: string, note?: string) => ({
  label,
  ...(value !== undefined ? { value: String(value) } : {}),
  ...(fact ? { fact } : {}),
  ...(note ? { note } : {}),
});

export function flows(d: Omit<LearnData, "flows">): Record<string, Flow> {
  const t = d.ingest.tables;
  const orders = need(t[0], "the orders table");
  const docs = new Map<string, number>();
  for (const s of d.ingest.sections) docs.set(s.file, (docs.get(s.file) ?? 0) + 1);
  const ch = d.analysis.change;
  const wholesale = need(
    d.analysis.channel.find((c) => c.member === "wholesale"),
    "the wholesale split",
  );
  const email = d.retrieval.hits.find((h) => h.file.endsWith(".eml"));
  const v = d.verifier;
  const failed = v.checks.reduce((a, c) => a + c.failed, 0);
  return {
    ingest: {
      stage: "INGEST · PROFILE",
      inputs: d.ingest.files.map((x) => item(x.name, `${x.bytes.toLocaleString("en-US")} bytes`)),
      steps: [
        {
          label: "Find the tables",
          detail: "Each sheet is scanned for blocks of cells with a header row; one sheet can hold several tables.",
          outputs: [0, 1, 2],
        },
        {
          label: "Split the documents",
          detail: "PDF pages, Word headings and the email body become sections with their position.",
          outputs: [3],
        },
        {
          label: "Profile",
          detail: "Types, dates, keys and outliers are measured in SQL; problems become data-quality items.",
          outputs: [4, 5, 6],
        },
      ],
      outputs: [
        ...t.map((x) => item(`${x.id} ${x.sheet}!${x.range}`, `${x.rows.toLocaleString("en-US")} rows`)),
        item("document sections", d.ingest.sections.length, undefined, [...docs.entries()].map(([k, n]) => `${k} ${n}`).join(" · ")),
        item("date range", `${orders.first} → ${orders.last}`, undefined, `${orders.grain} grain`),
        ...d.ingest.quality.map((q) => item(`${q.id} ${q.kind}`, q.severity, undefined, q.where)),
        item("entities", d.ingest.entities.count, undefined, d.ingest.entities.merged.map((m) => m.raw).join(" + ")),
      ],
      source: "the job's DuckDB tables: files, sources, profile_tables, quality_issues, entities",
    },
    metrics: {
      stage: "METRICS_DRAFT · AWAIT_CONFIRM",
      inputs: [
        item(
          `${orders.id} ${orders.sheet}`,
          `${orders.columns.length} columns`,
          undefined,
          orders.columns.map((c) => `${c.name}:${c.type}`).join(" · "),
        ),
      ],
      steps: [
        {
          label: "Draft",
          detail: "A model (or deterministic rules) writes each metric as a small YAML definition.",
          outputs: d.metrics.defs.map((_, i) => i),
        },
        {
          label: "Validate",
          detail: "Every column, filter and unit is checked against the profiled table; a bad definition is refused with a reason.",
          outputs: [],
        },
        {
          label: "Compile",
          detail: "Each definition becomes one parameterised SQL query, run in DuckDB.",
          outputs: [d.metrics.defs.length],
        },
      ],
      outputs: [
        ...d.metrics.defs.map((m) => item(m.id, m.status)),
        item(
          "revenue, 2026-04",
          undefined,
          d.metrics.revenue.series.find((s) => s.period === "2026-04")?.fact,
          "one row of the compiled query",
        ),
      ],
      source: "metric_defs and the MEASURE facts of the run",
    },
    analysis: {
      stage: "MEASURE · DETECT · DECOMPOSE",
      inputs: d.metrics.revenue.series.map((s) => item(`revenue ${s.period}`, undefined, s.fact)),
      steps: [
        {
          label: "Compare",
          detail: "The latest month against the one before, as SQL facts and a function fact for the change.",
          outputs: [0, 1],
        },
        {
          label: "Test against noise",
          detail: "Is the move bigger than the series usually wobbles? A robust z-score and a noise band answer it.",
          outputs: [2],
        },
        {
          label: "Split the change",
          detail: "Who moved? Contribution by channel, and price × volume × mix by product.",
          outputs: [3, 4, 5],
        },
      ],
      outputs: [
        item("change", undefined, ch.delta),
        item("change %", undefined, ch.pct),
        item("robust z", undefined, d.analysis.noise.z, `threshold ±${d.analysis.noise.threshold}`),
        item("wholesale", undefined, wholesale.delta),
        item("share of the drop", undefined, wholesale.share),
        item("PVM mix effect", undefined, d.analysis.pvm.mix),
      ],
      source: "facts, insights and decompositions of the run",
    },
    retrieval: {
      stage: "INDEX_DOCS · search_documents",
      inputs: [
        item("query", d.retrieval.query),
        item("chunks indexed", d.retrieval.chunks, undefined, `${d.retrieval.embedder} · ${d.retrieval.stemmer} stemmer`),
      ],
      steps: [
        { label: "BM25", detail: "Keyword search: chunks that share the query's words, weighted by how rare the words are.", outputs: [0] },
        { label: "Vectors", detail: "Meaning search: chunks whose embedding points the same way as the query's.", outputs: [1] },
        { label: "Fuse (RRF)", detail: "Each list votes 1/(60 + rank); a chunk near the top of both wins.", outputs: [2] },
        { label: "Rerank", detail: "A cross-encoder would reorder the top chunks. Not run offline: the result says so.", outputs: [3] },
      ],
      outputs: [
        item("email BM25 rank", email?.bm25 ?? "–", undefined, email?.file),
        item("email vector rank", email?.vector ?? "–"),
        item("email RRF score", email ? email.rrf.toFixed(4) : "–"),
        item("rerank", d.retrieval.degraded.includes("rerank") ? "skipped (degraded: rerank)" : "ran"),
      ],
      source: "searchDocuments() on the run's index, with the planner's own query",
    },
    web: {
      stage: "WEB_CONTEXT · search_web",
      inputs: [item("the planner asked", d.web.asked)],
      steps: [
        { label: "Sanitize", detail: "Names, numbers, emails and file names are cut before anything leaves the machine.", outputs: [0, 1] },
        {
          label: "Fetch safely",
          detail: "Every address is checked before connecting; private and metadata addresses are refused.",
          outputs: [2, 3, 4],
        },
        {
          label: "Screen and extract",
          detail: "A page that talks to a model is quarantined; the rest goes to the quarantined extractor.",
          outputs: [5],
        },
      ],
      outputs: [
        item("sent", d.web.sent),
        item("removed", d.web.removed.length, undefined, d.web.removed.map((r) => `${r.kind}: ${r.text}`).join(" · ")),
        ...d.web.results.map((r) => item(r.outcome, r.url)),
        item("benchmark gap", undefined, d.web.gap ?? undefined, d.web.statement?.quote),
      ],
      source: "the run's web_results, quarantine and the search provider's log",
    },
    agent: {
      stage: "EXPLAIN · DECIDE",
      inputs: [item("finding", d.agent.finding), item("tools", d.agent.tools.length, undefined, d.agent.tools.join(" · "))],
      steps: d.agent.calls.slice(0, 5).map((c, i) => ({ label: c.tool, detail: short(c.input, 120), outputs: [i] })),
      outputs: d.agent.calls.slice(0, 5).map((c) => item(c.tool, undefined, undefined, short(c.output, 140))),
      source: "the planner's tool calls in the run (scripted planner)",
    },
    verifier: {
      stage: "VERIFY",
      inputs: [item("draft claims", v.summary.claims_shipped + v.dropped.length), item("facts to recompute", v.summary.numbers_checked)],
      steps: v.checks.map((c, i) => ({ label: `${c.check} ${c.name}`, detail: `${c.run} checks, ${c.failed} failed`, outputs: [i] })),
      outputs: [
        ...v.checks.map((c) => item(c.check, `${c.run - c.failed}/${c.run}`, undefined, c.failed ? `${c.failed} failed` : "all passed")),
        item("dropped", v.dropped.length),
        item("rewritten or downgraded", v.downgraded.length),
        item("mismatched numbers", v.summary.numbers_mismatched),
      ],
      source: `the verifier's check table (${failed} failed checks in all)`,
    },
    report: {
      stage: "RENDER",
      inputs: [item("verified claims", v.summary.claims_shipped), item("facts", d.report.facts)],
      steps: [
        {
          label: "Fill the placeholders",
          detail: "Every {{N…}} in the text becomes the fact's stored value, formatted for reading.",
          outputs: [0, 1],
        },
        { label: "Attach the chips", detail: "Each number keeps its fact id, which opens its SQL or function and its rows.", outputs: [2] },
        {
          label: "Rank the actions",
          detail: "Recommendations carry an impact range made of facts and a check to run later.",
          outputs: [3],
        },
      ],
      outputs: [
        item("headline change", undefined, ch.pct),
        item("from", undefined, ch.before),
        item("to", undefined, ch.after),
        item(`${d.report.action.id} impact`, undefined, d.report.action.low, `to ${d.report.action.high}, ${d.report.action.horizon}`),
      ],
      source: "the verified report.json of the run",
    },
    router: {
      stage: "the model layer",
      inputs: [item("PLANNER_MODEL", d.router.spec)],
      steps: d.router.calls.map((c, i) => ({
        label: `${c.endpoint ?? c.provider} → ${c.status}`,
        detail: c.error ?? (c.cached ? "served from the cache" : "answered"),
        outputs: [i],
      })),
      outputs: d.router.calls.map((c) =>
        item(`${c.endpoint ?? c.provider} ${c.status}`, c.cached ? "cached" : `${c.inputTokens ?? "–"} in / ${c.outputTokens ?? "–"} out`),
      ),
      source: "the call log of the real client on a scripted transport (no network)",
    },
    security: {
      stage: "quarantine · screen · safe fetch",
      inputs: [item("poisoned email", d.security.injectionRun.file), item("search results", d.web.results.length)],
      steps: [
        { label: "Screen", detail: "Text that addresses a model is flagged before any model reads it.", outputs: [0, 1] },
        {
          label: "Quarantine",
          detail: "Flagged sources never reach the planner; the report lists them as data-quality items.",
          outputs: [2],
        },
        { label: "Refuse addresses", detail: "The fetcher refuses private, local and metadata addresses before connecting.", outputs: [3] },
      ],
      outputs: [
        item("lines flagged", `${d.security.screen.filter((s) => s.flagged).length}/${d.security.screen.length}`),
        item("facts unchanged", d.security.injectionRun.sameFacts ? "yes" : "no"),
        item("quarantined page", d.security.quarantined[0]?.url ?? "–"),
        item("refused URLs", d.security.ssrf.filter((s) => s.code !== "ALLOWED").length),
      ],
      source: "the run's quarantine table, screen() on the injection suite, checkUrl()",
    },
  };
}
