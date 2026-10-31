// 1. The web-enabled run, with the planner recorded (learn-data.ts): the same run as the README GIF and the landing page
// (pipeline-data.ts recordRun()), with the planner's tool calls and structured answers recorded and the workspace read
// after the run.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateTerms } from "@agentic-analytics/agent";
import { runJob } from "@agentic-analytics/core";
import { coffeePlanner, coffeeWeb } from "@agentic-analytics/core/testing";
import type { ModelClient } from "@agentic-analytics/models";
import { hashEmbedder, searchDocuments } from "@agentic-analytics/retrieval";
import type { Report } from "@agentic-analytics/schema";
import { sql, Workspace } from "@agentic-analytics/store";
import { sanitizeQuery, WebError } from "@agentic-analytics/web";
import type { LearnFact } from "../../src/components/learn/types.ts";
import { coffeeFiles, LearnDataError, NOW, need, num, type Row, short, str, TODAY } from "./shared.ts";

interface ToolLog {
  readonly prompt: string;
  readonly tools: readonly string[];
  readonly steps: readonly { readonly toolCalls: readonly { toolName: string; input: unknown; output?: unknown; error?: string }[] }[];
}

export async function stageRun() {
  const dir = mkdtempSync(join(tmpdir(), "aa-learn-"));
  try {
    const planner = coffeePlanner({ web: true });
    const toolLogs: ToolLog[] = [];
    const objects: { role: string; prompt: string; object: unknown }[] = [];
    const roles: Record<string, number> = {};
    const model: ModelClient = {
      async generateObject(a) {
        const r = await planner.generateObject(a);
        roles[a.role] = (roles[a.role] ?? 0) + 1;
        objects.push({ role: a.role, prompt: a.prompt, object: r.object });
        return r;
      },
      async generateWithTools(a) {
        const r = await planner.generateWithTools(a);
        roles[a.role] = (roles[a.role] ?? 0) + 1;
        toolLogs.push({ prompt: a.messages.at(-1)?.content ?? "", tools: Object.keys(a.tools), steps: r.steps });
        return r;
      },
      embed: (t) => planner.embed(t),
    };
    // The web fixture, with the fetcher's refusals recorded (the run itself skips them and carries on).
    const web = coffeeWeb();
    const refused: { url: string; code: string; message: string }[] = [];
    const fetchPage = async (url: string) => {
      try {
        return await web.fetchPage(url);
      } catch (err) {
        if (err instanceof WebError) refused.push({ url, code: err.code, message: err.message });
        throw err;
      }
    };
    const events: { type: string; stage?: string }[] = [];
    const out = await runJob(
      { dir, jobId: "coffee-demo", files: coffeeFiles(), options: { today: TODAY, currency: "USD", web: true } },
      {
        model,
        embedder: hashEmbedder(),
        web: { provider: web.provider, fetchPage },
        onEvent: (e) => events.push(e as { type: string; stage?: string }),
        now: NOW,
      },
    );
    const ws = await Workspace.open(join(dir, "job.duckdb"));
    try {
      return await readRun(ws, out.report, out.draft, { toolLogs, objects, roles, events, queries: web.queries, refused });
    } finally {
      ws.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function readRun(
  ws: Workspace,
  report: Report,
  draft: Report,
  rec: {
    toolLogs: ToolLog[];
    objects: { role: string; prompt: string; object: unknown }[];
    roles: Record<string, number>;
    events: { type: string; stage?: string }[];
    queries: string[];
    refused: { url: string; code: string; message: string }[];
  },
) {
  const all = <T extends Row>(q: ReturnType<typeof sql>) => ws.all<T>(q);
  const verifiedIds = new Set(report.facts.filter((f) => f.verified).map((f) => f.id));
  const factRows = await all<Row>(sql`SELECT id, label, value, unit, currency, kind, sql, params, fn, inputs FROM facts`);
  const allFacts = new Map<string, LearnFact>(
    factRows.map((r) => {
      const kind = r.kind === "sql" ? "sql" : "function";
      const fact: LearnFact = {
        id: String(r.id),
        label: String(r.label),
        value: num(r.value),
        unit: String(r.unit),
        currency: str(r.currency),
        verified: verifiedIds.has(String(r.id)),
        computation:
          kind === "sql"
            ? { kind, sql: String(r.sql), params: r.params ? (JSON.parse(String(r.params)) as unknown) : [] }
            : { kind, fn: String(r.fn), inputs: (r.inputs as string[] | null) ?? [] },
      };
      return [fact.id, fact];
    }),
  );
  const used = new Set<string>();
  const use = (id: string | undefined | null, what: string): string => {
    const f = need(id ? allFacts.get(id) : undefined, `fact ${id ?? "?"} (${what})`);
    used.add(f.id);
    return f.id;
  };
  const byLabel = (label: string) => need([...allFacts.values()].find((f) => f.label === label)?.id, `the fact labelled ${label}`);

  // Ingest and profile.
  const files = await all<Row>(sql`SELECT id, name, kind, size FROM files ORDER BY name`);
  const fileName = new Map(files.map((f) => [String(f.id), String(f.name)]));
  const sources = await all<Row>(
    sql`SELECT id, file_id, kind, sheet, range_a1, page, section, char_start, char_end FROM sources ORDER BY id`,
  );
  const profile = new Map((await all<Row>(sql`SELECT * FROM profile_tables`)).map((p) => [String(p.table_id), p] as const));
  const columns = await all<Row>(sql`SELECT table_id, position, name, label, letter, type FROM table_columns ORDER BY table_id, position`);
  const tables = sources
    .filter((s) => s.kind === "table")
    .map((s) => {
      const p = profile.get(String(s.id));
      return {
        id: String(s.id),
        file: fileName.get(String(s.file_id)) ?? String(s.file_id),
        sheet: String(s.sheet),
        range: String(s.range_a1),
        rows: num(need(p, `profile of ${String(s.id)}`).row_count),
        columns: columns
          .filter((c) => c.table_id === `t_${String(s.id).toLowerCase()}` || c.table_id === s.id)
          .map((c) => ({ letter: String(c.letter), name: String(c.name), label: String(c.label), type: String(c.type) })),
        dateColumn: str(p?.date_column),
        first: str(p?.date_first)?.slice(0, 10) ?? null,
        last: str(p?.date_last)?.slice(0, 10) ?? null,
        grain: str(p?.grain),
        key: ((p?.key_columns as string[] | null) ?? []).map(String),
      };
    });
  const sections = sources
    .filter((s) => s.kind !== "table" && s.kind !== "web")
    .map((s) => ({
      id: String(s.id),
      file: fileName.get(String(s.file_id)) ?? String(s.file_id),
      kind: String(s.kind),
      where: s.page ? `page ${String(s.page)}` : ((s.section as string[] | null) ?? []).join(" › "),
      chars: num(s.char_end) - num(s.char_start),
    }));
  const quality = (await all<Row>(sql`SELECT id, kind, severity, message, sheet, cell, column_name FROM quality_issues ORDER BY id`)).map(
    (q) => ({
      id: String(q.id),
      kind: String(q.kind),
      severity: String(q.severity),
      message: String(q.message),
      where: [q.sheet, q.cell ?? (q.column_name ? `column ${String(q.column_name)}` : null)].filter(Boolean).join(" · "),
    }),
  );
  const entities = await all<Row>(sql`SELECT count(*) AS n FROM entities`);
  const merged = await all<Row>(sql`
    SELECT l.raw_value, e.canonical_name, l.confidence, l.row_count FROM entity_links l JOIN entities e ON e.id = l.entity_id
    WHERE l.entity_id IN (SELECT entity_id FROM entity_links GROUP BY entity_id HAVING count(*) > 1) ORDER BY l.confidence, l.raw_value`);

  // Metrics.
  const defs = (await all<Row>(sql`SELECT id, yaml, status FROM metric_defs ORDER BY rowid`)).map((d) => ({
    id: String(d.id),
    label: /\nlabel: (.+)\n/.exec(String(d.yaml))?.[1] ?? String(d.id),
    status: String(d.status),
    yaml: String(d.yaml),
  }));
  const revenueDef = need(await ws.one<Row>(sql`SELECT sql, params FROM metric_defs WHERE id = 'revenue'`), "the revenue definition");
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
  const series = months.map((p) => ({ period: p, fact: use(byLabel(`revenue_${p}`), `revenue ${p}`) }));

  // Analysis: the headline change, the noise band, the channel split, PVM.
  const insights = await all<Row>(
    sql`SELECT id, template, metric_id, period, payload FROM insights ORDER BY CAST(substr(id, 2) AS INTEGER)`,
  );
  const payload = (id: string) =>
    JSON.parse(
      String(
        need(
          insights.find((i) => i.id === id),
          `insight ${id}`,
        ).payload,
      ),
    ) as {
      template: string;
      facts: Record<string, string>;
      details: Record<string, number>;
    };
  const top = need(report.findings[0], "the top finding");
  const trend = need(
    insights.find((i) => i.template === "trend_break.v1" && i.metric_id === "revenue" && i.period === "2026-04"),
    "the revenue trend break",
  );
  const tb = payload(String(trend.id));
  const anomaly = need(
    insights.find((i) => i.template === "anomaly.v1" && i.metric_id === "revenue" && i.period === "2026-04"),
    "the revenue anomaly",
  );
  const an = payload(String(anomaly.id));
  const decomps = await all<Row>(sql`SELECT id, method, payload FROM decompositions ORDER BY CAST(substr(id, 2) AS INTEGER)`);
  const dp = (method: string, dimension: string) => {
    const d = need(
      decomps.find((x) => x.method === method && (JSON.parse(String(x.payload)) as { dimension?: string }).dimension === dimension),
      `${method} by ${dimension}`,
    );
    return JSON.parse(String(d.payload)) as { facts: Record<string, string> };
  };
  const channel = dp("contribution.v1", "channel");
  const pvm = dp("pvm.v1", "product");
  const members = Object.keys(channel.facts)
    .filter((k) => k.startsWith("change:"))
    .map((k) => k.slice("change:".length));

  // Retrieval: the planner's own document query, searched again on the run's index.
  const docCall = rec.toolLogs.flatMap((l) => l.steps.flatMap((s) => s.toolCalls)).find((c) => c.toolName === "search_documents");
  const query = need((docCall?.input as { query?: string } | undefined)?.query, "the planner's document query");
  const r = await searchDocuments(ws, query, { embedder: hashEmbedder(), k: 8 });
  const meta = need(await ws.one<Row>(sql`SELECT embedder, stemmer, chunks FROM retrieval_meta`), "the retrieval index");
  const chunkSource = new Map(
    (await all<Row>(sql`SELECT id, source_id FROM chunks`)).map((c) => [String(c.id), String(c.source_id)] as const),
  );
  const extract = await ws.one<{ payload: string }>(
    sql`SELECT payload::VARCHAR AS payload FROM extracts WHERE chunk_id = ${r.hits[0]?.chunk_id ?? ""} AND NOT suspicious ORDER BY CAST(substr(id, 2) AS INTEGER) LIMIT 1`,
  );

  // Web lane: what the planner asked, what was sent, what came back.
  const webCall = rec.toolLogs.flatMap((l) => l.steps.flatMap((s) => s.toolCalls)).find((c) => c.toolName === "search_web");
  const asked = String((webCall?.input as { query?: string } | undefined)?.query ?? "");
  // What the sanitizer took out, from the same function and the same private terms the run used.
  const sanitized = sanitizeQuery(asked, await privateTerms(ws));
  if (sanitized.query !== rec.queries[0])
    throw new LearnDataError(`the sanitizer gives "${sanitized.query}", the run sent "${rec.queries[0] ?? ""}"`);
  const quarantine = await all<Row>(
    sql`SELECT q.source_id, q.reason, w.url FROM quarantine q JOIN web_results w ON w.id = q.source_id ORDER BY q.source_id`,
  );
  const webResults = await all<Row>(sql`SELECT id, url FROM web_results ORDER BY id`);
  const webSource = report.sources.find((s) => s.external);
  const webClaim = report.findings.flatMap((f) => f.claims).find((c) => c.citations.some((x) => x.source_id === webSource?.id));
  const webCite = webClaim?.citations.find((x) => x.source_id === webSource?.id);

  // The planner: the revenue investigation's tool calls, and one structured answer (the explanation draft).
  const revenueLog = need(
    rec.toolLogs.find((l) => /\(([\w.]+), revenue, 2026-04\)/.test(l.prompt)),
    "the revenue investigation",
  );
  const refundLog = rec.toolLogs.find((l) => l.steps.some((s) => s.toolCalls.some((c) => c.toolName === "search_web")));
  const calls = [revenueLog, refundLog]
    .filter((l): l is ToolLog => !!l)
    .flatMap((l, k) =>
      l.steps.flatMap((s, i) =>
        s.toolCalls.map((c) => ({
          step: k * 10 + i + 1,
          tool: c.toolName,
          input: c.input,
          output: short(c.error ?? c.output, 420),
        })),
      ),
    );
  const explanation = rec.objects.find((o) => o.role === "planner" && /Write the explanation/.test(o.prompt));

  // Verifier.
  const names: Record<string, string> = {
    V1: "placeholders",
    V2: "recompute",
    V3: "re-derive",
    V4: "definitions",
    V5: "citations",
    V6: "causal language",
    V7: "grounding",
    V8: "external",
  };
  const vrows = await all<Row>(sql`SELECT check_name, passed FROM verification`);
  const dropped = [...draft.verification.claims_dropped, ...report.verification.claims_dropped].filter(
    (d, i, a) => a.findIndex((x) => x.claim === d.claim && x.reason === d.reason) === i,
  );

  // Report.
  const sourceFile = (id: string) => {
    const s = report.sources.find((x) => x.id === id);
    return s?.file ?? id;
  };
  for (const c of top.claims) for (const id of c.facts) use(id, "the top finding");
  const action = need(report.recommendations[0], "the top action");
  const impact = need(action.impact, "the action's impact");

  const ids = {
    change: {
      before: use(tb.facts.before, "before"),
      after: use(tb.facts.after, "after"),
      delta: use(tb.facts.change, "change"),
      pct: use(tb.facts.change_pct, "change %"),
    },
    z: use(an.facts.robust_z, "robust z"),
    shift: use(tb.facts.shift, "shift"),
    channel: members.map((m) => ({ member: m, delta: use(channel.facts[`change:${m}`], m), share: use(channel.facts[`share:${m}`], m) })),
    channelTotal: use(channel.facts.total, "channel total"),
    pvm: {
      volume: use(pvm.facts.volume, "volume"),
      mix: use(pvm.facts.mix, "mix"),
      price: use(pvm.facts.price, "price"),
      total: use(pvm.facts.total, "pvm total"),
    },
    gap: webClaim?.facts[0] ? use(webClaim.facts[0], "benchmark gap") : null,
    low: use(impact.low, "impact low"),
    high: use(impact.high, "impact high"),
  };
  // Every input of a shown fact is shown too, so each ledger row's computation opens onto rows that exist.
  const closure = (id: string) => {
    const f = allFacts.get(id);
    if (!f) return;
    for (const i of f.computation.inputs ?? [])
      if (!used.has(i)) {
        used.add(i);
        closure(i);
      }
  };
  for (const id of [...used]) closure(id);

  const stages = rec.events.filter((e) => e.type === "stage_completed").map((e) => String(e.stage));
  return {
    run: { stages, events: rec.events.length },
    facts: Object.fromEntries(
      [...used].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((id) => [id, allFacts.get(id) as LearnFact]),
    ),
    ingest: {
      files: files.map((f) => ({ id: String(f.id), name: String(f.name), kind: String(f.kind), bytes: num(f.size) })),
      tables,
      sections,
      quality,
      entities: {
        count: num(entities[0]?.n),
        merged: merged.map((m) => ({
          raw: String(m.raw_value),
          canonical: String(m.canonical_name),
          confidence: num(m.confidence),
          rows: num(m.row_count),
        })),
      },
    },
    metrics: { defs, revenue: { sql: String(revenueDef.sql), params: JSON.parse(String(revenueDef.params)) as unknown, series } },
    analysis: {
      change: ids.change,
      noise: {
        z: ids.z,
        threshold: need(an.details.threshold, "the anomaly threshold"),
        band: need(tb.details.noise_band, "the noise band"),
        shift: ids.shift,
        template: tb.template,
      },
      channel: ids.channel,
      channelTotal: ids.channelTotal,
      pvm: ids.pvm,
      templates: insights.map((i) => ({
        id: String(i.id),
        template: String(i.template),
        metric: String(i.metric_id),
        period: String(i.period),
      })),
    },
    retrieval: {
      query,
      embedder: String(meta.embedder),
      stemmer: String(meta.stemmer),
      chunks: num(meta.chunks),
      degraded: [...r.degraded],
      hits: r.hits.map((h) => ({
        chunk: h.chunk_id,
        source: chunkSource.get(h.chunk_id) ?? h.source_id,
        file: h.file,
        heading: h.heading_path.join(" › "),
        text: h.text.replace(/\s+/g, " ").trim(),
        bm25: h.bm25_rank ?? null,
        vector: h.vector_rank ?? null,
        rrf: h.score,
      })),
      extract: extract ? (JSON.parse(extract.payload) as unknown) : null,
    },
    web: {
      asked,
      sent: need(rec.queries[0], "the query sent to the search provider"),
      removed: sanitized.removed.map((x) => ({ kind: x.kind, text: x.text.trim() })),
      results: [
        ...webResults.map((w) => {
          const q = quarantine.find((x) => x.source_id === w.id);
          return {
            url: String(w.url),
            outcome: q ? ("quarantined" as const) : ("kept" as const),
            why: q ? String(q.reason) : `stored as external source ${String(w.id)}; the extractor read it`,
          };
        }),
        ...rec.refused.map((x) => ({ url: x.url, outcome: "refused" as const, why: `${x.code}: ${x.message}` })),
      ],
      statement: webCite?.quote && webSource ? { source: webSource.id, quote: webCite.quote, url: webSource.file ?? "" } : null,
      gap: ids.gap,
    },
    agent: {
      tools: revenueLog.tools,
      finding: top.title,
      calls,
      structured: explanation ? { role: explanation.role, schema: "ExplainOutput", object: explanation.object } : null,
      roles: rec.roles,
    },
    verifier: {
      checks: Object.entries(names).map(([check, name]) => {
        const rows = vrows.filter((v) => v.check_name === check);
        return { check, name, run: rows.length, failed: rows.filter((v) => !v.passed).length };
      }),
      dropped: dropped.map((d) => ({ claim: d.claim, reason: d.reason })),
      downgraded: report.verification.claims_downgraded.map((d) => ({ claim: d.claim, from: d.from, to: d.to, reason: d.reason })),
      summary: {
        numbers_checked: report.verification.numbers_checked,
        numbers_mismatched: report.verification.numbers_mismatched,
        citations_checked: report.verification.citations_checked,
        claims_shipped: report.findings.reduce((a, f) => a + f.claims.length, 0),
      },
    },
    report: {
      headline: report.summary.headline,
      finding: {
        id: top.id,
        title: top.title,
        claims: top.claims.map((c) => ({
          text: c.text,
          facts: c.facts,
          grade: c.causal_grade ?? null,
          citations: c.citations.map((x) => ({
            source: x.source_id,
            file: sourceFile(x.source_id),
            quote: x.quote ?? null,
            rows: x.rows?.length ?? 0,
          })),
        })),
      },
      action: { id: action.id, text: action.action, low: ids.low, high: ids.high, horizon: impact.horizon },
      facts: report.facts.length,
    },
  };
}
