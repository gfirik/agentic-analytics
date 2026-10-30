// The data behind the Learn section (docs/DOCS-SITE.md §1; types in src/components/learn/types.ts). Nothing on a
// Learn page is typed by hand: every number, fact id, SQL text, quote, retrieval rank, verifier count, call-log record
// and terminal transcript is recorded here from real engine runs on examples/coffee-roaster, offline and
// deterministic (scripted planner, hash embedder, the offline web fixture). Formatting is presentation only.
//   tsx apps/docs/scripts/learn-data.ts --write   → docs/assets/learn/learn.json (checked in)
// scripts/test/learn.test.ts regenerates it and fails on drift.
//
// What runs:
//   1. one web-enabled job, the same run as the README GIF and the landing page (pipeline-data.ts recordRun()), with
//      the planner's tool calls and structured answers recorded and the workspace read after the run;
//   2. the CLI itself (`aa analyze`, `aa metrics`, `aa explain`, `aa eval`), spawned with a clean environment in a
//      scratch folder, for the tutorials' transcripts;
//   3. the MCP server through the MCP SDK's in-memory client;
//   4. the model router on a scripted transport (no network, no keys);
//   5. one injection fixture through a full job, the injection screen on every fixture, and the URL checks.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { privateTerms, screen } from "@agentic-analytics/agent";
import { JobManager, runJob } from "@agentic-analytics/core";
import { coffeePlanner, coffeeWeb } from "@agentic-analytics/core/testing";
import { coffeeRoasterFiles, injectionFixtures } from "@agentic-analytics/eval-datasets";
import type { RealSuiteResult } from "@agentic-analytics/eval-runner";
import { createMcpServer } from "@agentic-analytics/mcp";
import { type CallRecord, createModelClient, type ModelClient, memoryCache, resolveModelConfig } from "@agentic-analytics/models";
import { hashEmbedder, searchDocuments } from "@agentic-analytics/retrieval";
import type { Report } from "@agentic-analytics/schema";
import { sql, Workspace } from "@agentic-analytics/store";
import { checkUrl, sanitizeQuery, WebError } from "@agentic-analytics/web";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { type FactLike, formatWithCurrency } from "../src/components/format.ts";
import type { Flow, LearnData, LearnFact, Transcript } from "../src/components/learn/types.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
export const LEARN_JSON = join(ROOT, "docs", "assets", "learn", "learn.json");
const TODAY = "2026-07-01";
const NOW = () => new Date("2026-07-01T09:00:00Z");

export class LearnDataError extends Error {
  readonly code = "LEARN_DATA";
  constructor(message: string) {
    super(`learn data: ${message}`);
    this.name = "LearnDataError";
  }
}

const need = <T>(v: T | undefined | null, what: string): T => {
  if (v === undefined || v === null) throw new LearnDataError(`${what} not found in the run`);
  return v;
};

const coffeeFiles = () => Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
const short = (v: unknown, n = 360) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

// ── 1. The web-enabled run, with the planner recorded ──────────────────────────────────────────────────────────

interface ToolLog {
  readonly prompt: string;
  readonly tools: readonly string[];
  readonly steps: readonly { readonly toolCalls: readonly { toolName: string; input: unknown; output?: unknown; error?: string }[] }[];
}

async function stageRun() {
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

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => Number(v);

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

// ── 2. The CLI, spawned as a reader runs it ─────────────────────────────────────────────────────────────────────

const AA = join(ROOT, "apps", "cli", "bin", "aa.js");

interface Spawned {
  readonly out: string;
  readonly code: number;
}

/** Runs `aa <args>` in `cwd` with only the variables given (no .env, no config file, no inherited model settings). */
function aa(args: readonly string[], cwd: string, env: Record<string, string>, input?: string): Promise<Spawned> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [AA, ...args], {
      cwd,
      env: { PATH: process.env.PATH ?? "", HOME: cwd, NO_COLOR: "1", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      out += c.toString();
    });
    const timer = setTimeout(() => child.kill(), 240_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ out, code: code ?? -1 });
    });
    child.stdin.end(input ?? "");
  });
}

const JOB_ID = /job-\d{14}-[0-9a-f]{6}/g;

/** Presentation of a recorded session: what varies per machine or run is replaced, and the page says what. */
function transcript(command: string, raw: string, replace: readonly [RegExp | string, string, string][]): Transcript {
  let text = raw;
  const normalised: string[] = [];
  for (const [from, to, why] of replace) {
    const before = text;
    text = typeof from === "string" ? text.split(from).join(to) : text.replace(from, to);
    if (text !== before && !normalised.includes(why)) normalised.push(why);
  }
  const lines = text.replace(/\n+$/, "").split("\n");
  return { command, lines, normalised };
}

const DURATIONS: [RegExp, string, string] = [/\((\d+) ms\)/g, "(… ms)", "stage durations"];
const JOBS: [RegExp, string, string] = [JOB_ID, "<job-id>", "the job id (a timestamp)"];

async function cliRuns() {
  const tmp = mkdtempSync(join(tmpdir(), "aa-learn-cli-"));
  try {
    symlinkSync(join(ROOT, "examples"), join(tmp, "examples"));
    // The CLI's HOME is this empty folder, but DuckDB keeps its extensions under $HOME/.duckdb: link the real one, so
    // the full-text extension every engine run on this machine has installed is reused, not downloaded again (offline,
    // a download fails the run).
    const duckdb = join(homedir(), ".duckdb");
    mkdirSync(duckdb, { recursive: true });
    symlinkSync(duckdb, join(tmp, ".duckdb"));
    const jobs = join(tmp, "jobs");
    const scripted = { AA_DEMO_MODEL: "scripted", AA_JOBS_DIR: jobs };
    const base = "--embedder hash --today 2026-07-01 --currency USD";
    const out = (name: string) => join(tmp, name);
    const paths = (dir: string): [string, string, string] => [`${dir}/`, "", "the report folder (the current folder)"];

    // Tutorial 1: the first file.
    const first = await aa(["analyze", "examples/coffee-roaster", "--yes", ...base.split(" "), "--out", out("first")], tmp, scripted);
    if (first.code !== 0) throw new LearnDataError(`aa analyze failed:\n${first.out}`);
    const jobId = need(first.out.match(JOB_ID)?.[0], "the job id");
    // `aa explain` reads the stored facts: no model of any kind is involved.
    const explainPct = await aa(["explain", jobId, "N30"], tmp, { AA_JOBS_DIR: jobs });
    const explainSql = await aa(["explain", jobId, "N11"], tmp, { AA_JOBS_DIR: jobs });
    const ask = await aa(["ask", jobId, "why did revenue fall in April?"], tmp, scripted);

    // Tutorial 2: metrics, drafted and reviewed.
    const metrics = await aa(
      [
        "metrics",
        "examples/coffee-roaster",
        "--yes",
        "--currency",
        "USD",
        "--today",
        "2026-07-01",
        "--save",
        "agentic-analytics.metrics.yaml",
      ],
      tmp,
      // No model is running here: drafting falls back to deterministic rules and says why.
      { OLLAMA_BASE_URL: "http://127.0.0.1:9" },
    );
    const saved = readFileSync(join(tmp, "agentic-analytics.metrics.yaml"), "utf8");
    // The column roles (one question), the business model, then the ten metrics (the KPI pack's eight, then the retail and
    // wholesale slices): refund_rate, the eighth, is dropped.
    const answers = ["a", "a", "a", "a", "a", "a", "a", "a", "a", "d", "a", "a"];
    const review = await aa(
      ["analyze", "examples/coffee-roaster", ...base.split(" "), "--out", out("review")],
      tmp,
      scripted,
      `${answers.join("\n")}\n`,
    );
    if (review.code !== 0) throw new LearnDataError(`aa analyze (review) failed:\n${review.out}`);
    let k = 0;
    // Piped answers aren't echoed; a terminal shows what you typed after each question.
    const reviewOut = review.out.replace(/\[d\]rop: /g, (m) => `${m}${answers[k++] ?? ""}\n`);

    // Tutorial 3: the workbook alone, then with the documents.
    const alone = await aa(
      ["analyze", "examples/coffee-roaster/sales-2026.xlsx", "--yes", ...base.split(" "), "--out", out("alone")],
      tmp,
      scripted,
    );
    if (alone.code !== 0) throw new LearnDataError(`aa analyze (workbook only) failed:\n${alone.out}`);
    const claimsOf = (dir: string) => {
      const rep = JSON.parse(readFileSync(join(dir, "agentic-analytics", "report.json"), "utf8")) as Report;
      const f = need(rep.findings[0], "a finding");
      const facts = new Map(rep.facts.map((x) => [x.id, x]));
      return {
        title: f.title,
        claims: f.claims.map((c) => ({
          // Filled from this run's own facts (presentation only): the ids belong to this job, not the stage run.
          text: c.text.replace(/\{\{(N\d+)\}\}/g, (m, id: string) => {
            const x = facts.get(id);
            return x ? formatWithCurrency({ ...(x as FactLike), currency: x.currency ?? null }) : m;
          }),
          grade: c.causal_grade ?? null,
          sources: [...new Set(c.citations.map((x) => rep.sources.find((s) => s.id === x.source_id)?.file ?? x.source_id))],
        })),
      };
    };

    // Tutorial 5: evals on your own data.
    const evalRun = await aa(
      ["eval", "--suite", "real", "--answers", "examples/my-evals", "--data", "examples/coffee-roaster", "--results-dir", out("my-evals")],
      tmp,
      {},
    );
    if (evalRun.code !== 0) throw new LearnDataError(`aa eval failed:\n${evalRun.out}`);

    const transcripts: Record<string, Transcript> = {
      analyze: transcript(`AA_DEMO_MODEL=scripted bun run aa analyze examples/coffee-roaster --yes ${base}`, first.out, [
        DURATIONS,
        JOBS,
        paths(out("first")),
      ]),
      explainPct: transcript("bun run aa explain <job-id> N30", explainPct.out, [JOBS]),
      explainSql: transcript("bun run aa explain <job-id> N11", explainSql.out, [JOBS]),
      ask: transcript('AA_DEMO_MODEL=scripted bun run aa ask <job-id> "why did revenue fall in April?"', ask.out, [JOBS]),
      metrics: transcript(
        "bun run aa metrics examples/coffee-roaster --yes --currency USD --today 2026-07-01 --save agentic-analytics.metrics.yaml",
        metrics.out,
        [[/unavailable \([^)]*\)/g, "unavailable (…)", "the reason no model answered (it depends on your setup)"]],
      ),
      review: (() => {
        const t = transcript(`AA_DEMO_MODEL=scripted bun run aa analyze examples/coffee-roaster ${base}`, reviewOut, [
          DURATIONS,
          JOBS,
          paths(out("review")),
        ]);
        // The answers were piped in, and piped input isn't echoed: they are written after each question, as a terminal shows them.
        return { ...t, normalised: [...t.normalised, "your answers, written after each question (piped input isn't echoed)"] };
      })(),
      alone: transcript(`AA_DEMO_MODEL=scripted bun run aa analyze examples/coffee-roaster/sales-2026.xlsx --yes ${base}`, alone.out, [
        DURATIONS,
        JOBS,
        paths(out("alone")),
      ]),
      eval: transcript(
        "bun run aa eval --suite real --answers examples/my-evals --data examples/coffee-roaster --results-dir data/my-evals",
        evalRun.out,
        [
          [/ · \d+\.\d s/g, " · … s", "the run time"],
          [`${out("my-evals")}/`, "data/my-evals/", "the results folder"],
          [/\d{4}-\d{2}-\d{2}-baseline-real/g, "<date>-baseline-real", "the date in the results file name"],
        ],
      ),
    };
    return {
      transcripts,
      saved,
      evidence: { without: claimsOf(out("alone")), with: claimsOf(out("first")) },
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── 3. MCP: the server `aa mcp` runs, through the SDK's in-memory client ─────────────────────────────────────────

async function mcpRun() {
  const tmp = mkdtempSync(join(tmpdir(), "aa-learn-mcp-"));
  try {
    const input = join(tmp, "coffee-roaster");
    mkdirSync(input);
    for (const f of coffeeFiles()) writeFileSync(join(input, f.name), f.bytes);
    const manager = new JobManager({
      root: join(tmp, "jobs"),
      model: coffeePlanner(),
      deps: () => ({ model: coffeePlanner(), embedder: hashEmbedder() }),
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(manager, { today: () => TODAY }).connect(a);
    const client = new Client({ name: "learn", version: "0" });
    await client.connect(b);
    try {
      const textOf = (r: unknown) => (r as { content: { text: string }[] }).content[0]?.text ?? "";
      const { tools } = await client.listTools();
      const shown = "/path/to/agentic-analytics/examples/coffee-roaster";
      const call = async (tool: string, args: Record<string, unknown>, shownArgs = args) => {
        const t = textOf(await client.callTool({ name: tool, arguments: args }));
        return { tool, args: shownArgs, result: t.split(input).join(shown) };
      };
      const analyzed = await call(
        "analyze_files",
        { paths: [input], currency: "USD", wait: true },
        { paths: [shown], currency: "USD", wait: true },
      );
      const jobId = need(/^([\w-]+): /.exec(analyzed.result)?.[1], "the MCP job id");
      const explained = await call("explain_number", { job_id: jobId, fact_id: "N30" });
      const asked = await call("ask_report", { job_id: jobId, question: "Why did revenue drop in April?" });
      const norm = (c: { tool: string; args: unknown; result: string }) => ({
        ...c,
        args: JSON.parse(JSON.stringify(c.args).split(jobId).join("<job-id>")) as unknown,
        result: c.result.split(jobId).join("<job-id>"),
      });
      return {
        tools: tools.map((t) => ({ name: t.name, description: t.description ?? "" })).sort((x, y) => x.name.localeCompare(y.name)),
        calls: [analyzed, explained, asked].map(norm).map((c) => ({ ...c, result: short(c.result, 1400) })),
      };
    } finally {
      await client.close();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── 4. The model router on a scripted transport ─────────────────────────────────────────────────────────────────

async function routerRun() {
  // The AI SDK warns that one endpoint has no native JSON-schema mode; the client validates with Zod instead.
  (globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;
  // Two free endpoints serving the same model; the keys are placeholders (the transport never leaves the process).
  const env = {
    PLANNER_MODEL: "openai-compatible:groq:openai/gpt-oss-120b | openai-compatible:cerebras:gpt-oss-120b",
    GROQ_API_KEY: "placeholder-not-a-key",
    CEREBRAS_API_KEY: "placeholder-not-a-key",
  };
  const answer = { finding: "F1", grade: "document_supported" };
  const reply = (content: string) =>
    Response.json({
      id: "c",
      object: "chat.completion",
      created: 0,
      model: "gpt-oss-120b",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 412, completion_tokens: 18, total_tokens: 430 },
    });
  const script: Record<string, (() => Response)[]> = {
    "api.groq.com": [
      () =>
        new Response(
          JSON.stringify({
            error: { message: "Rate limit reached for model openai/gpt-oss-120b: tokens per minute. Please try again in 24.7s." },
          }),
          {
            status: 429,
            headers: { "retry-after": "25", "x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "24.7s" },
          },
        ),
    ],
    // The first answer breaks the schema (a grade that doesn't exist); the client feeds the error back and asks again.
    "api.cerebras.ai": [() => reply('{"finding":"F1","grade":"proven"}'), () => reply(JSON.stringify(answer))],
  };
  const transport = (async (input: string | URL | Request) => {
    const next = script[new URL(String(input instanceof Request ? input.url : input)).host]?.shift();
    return next ? next() : new Response("no script", { status: 500 });
  }) as typeof fetch;
  const calls: CallRecord[] = [];
  const client = createModelClient(resolveModelConfig(env), { env, fetch: transport, cache: memoryCache(), onCall: (c) => calls.push(c) });
  const schema = z.object({ finding: z.string(), grade: z.enum(["observed", "correlated", "document_supported"]) });
  const r = await client.generateObject({ role: "planner", schema, system: "Grade the finding.", prompt: "F1" });
  // The same request again: served from the response cache, and the log says so.
  await client.generateObject({ role: "planner", schema, system: "Grade the finding.", prompt: "F1" });
  return {
    spec: env.PLANNER_MODEL,
    calls: calls.map((c) => ({
      role: c.role ?? "",
      provider: c.provider,
      endpoint: c.endpoint ?? null,
      model: c.model,
      status: c.status,
      cached: c.cached,
      inputTokens: c.inputTokens ?? null,
      outputTokens: c.outputTokens ?? null,
      error: c.error ?? null,
    })),
    answer: r.object as unknown,
  };
}

// ── 5. Security: one poisoned email through a full job, the screen on every fixture, the URL checks ────────────────

async function securityRun() {
  const fixtures = injectionFixtures();
  const fx = need(
    fixtures.find((f) => f.id === "eml-forget-rules"),
    "the eml-forget-rules fixture",
  );
  const run = async (extra: Readonly<Record<string, Uint8Array>>) => {
    const dir = mkdtempSync(join(tmpdir(), "aa-learn-inj-"));
    try {
      const files = [...coffeeFiles(), ...Object.entries(extra).map(([name, bytes]) => ({ name, bytes }))];
      return (
        await runJob(
          { dir, jobId: "inj", files, options: { today: TODAY, currency: "USD" } },
          { model: coffeePlanner(), embedder: hashEmbedder(), now: NOW },
        )
      ).report;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const [clean, poisoned] = await Promise.all([run({}), run(fx.files)]);
  const factKey = (rep: Report) =>
    rep.facts
      .map((f) => `${f.label}=${f.value}`)
      .sort()
      .join("|");
  const urls = [
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:8080/v1/jobs",
    "http://2130706433/",
    "http://10.0.0.5/admin",
    "file:///etc/passwd",
    "https://user:pass@example.com/",
    "https://coffee-benchmarks.example:8443/refunds",
  ];
  return {
    fixtures: fixtures.length,
    // The screen on real lines: the poisoned email's body, and lines from the example's own documents.
    screen: [
      ...new TextDecoder()
        .decode(need(fx.files[fx.flagged], "the poisoned email"))
        .split(/\r?\n\r?\n/)
        .slice(1)
        .join("\n")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 12)
        .map((text) => ({ source: fx.flagged, text, flagged: screen(text) })),
      ...[
        ["email-0412.eml", "After the new price list we are pausing our standing order while we compare suppliers."],
        ["ops-notes.docx", "Switched to the new packaging supplier on 28 April."],
      ].map(([source, text]) => ({ source: source as string, text: text as string, flagged: screen(text as string) })),
    ],
    ssrf: urls.map((url) => {
      try {
        checkUrl(url);
        return { url, code: "ALLOWED", message: "" };
      } catch (err) {
        if (!(err instanceof WebError)) throw err;
        return { url, code: err.code, message: err.message };
      }
    }),
    injectionRun: {
      fixture: fx.id,
      file: fx.flagged,
      flagged: poisoned.data_quality
        .filter((q) => q.kind === "suspicious_instruction")
        .map((q) => ({ kind: q.kind, description: q.description.replace(/\{\{N\d+\}\}/g, "…") })),
      sameFacts: factKey(clean) === factKey(poisoned),
      phraseInReport: JSON.stringify(poisoned).toLowerCase().includes(fx.phrase.toLowerCase()),
    },
  };
}

// ── The real-data tier (committed results): seasonality and noise on public data ─────────────────────────────────

function realChecks() {
  const dir = join(ROOT, "evals", "results");
  const name = need(
    readdirSync(dir)
      .filter((f) => f.endsWith("-baseline-real.json"))
      .sort()
      .at(-1),
    "a baseline real-data results file",
  );
  const r = JSON.parse(readFileSync(join(dir, name), "utf8")) as RealSuiteResult;
  return {
    file: `evals/results/${name}`,
    checks: r.datasets.flatMap((d) =>
      d.checks
        .filter((c) => ["seasonal_peak", "seasonal_not_flagged", "no_finding_at", "quality_issue"].includes(c.kind))
        .map((c) => ({ dataset: d.dataset, title: d.title, check: c.id, about: c.about, pass: c.pass, detail: c.detail })),
    ),
  };
}

// ── Assemble ────────────────────────────────────────────────────────────────────────────────────────────────────

const item = (label: string, value?: string | number, fact?: string, note?: string) => ({
  label,
  ...(value !== undefined ? { value: String(value) } : {}),
  ...(fact ? { fact } : {}),
  ...(note ? { note } : {}),
});

function flows(d: Omit<LearnData, "flows">): Record<string, Flow> {
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

export async function recordLearn(): Promise<LearnData> {
  const [stage, cli, mcp, router, security] = await Promise.all([stageRun(), cliRuns(), mcpRun(), routerRun(), securityRun()]);
  const real = realChecks();
  const base: Omit<LearnData, "flows"> = {
    run: {
      example: "examples/coffee-roaster",
      model: "scripted planner (coffeePlanner), no LLM",
      web: "offline web fixture (coffeeWeb)",
      embedder: "hash (offline)",
      today: TODAY,
      ...stage.run,
    },
    facts: stage.facts,
    ingest: stage.ingest,
    metrics: stage.metrics,
    analysis: { ...stage.analysis, real: real.checks, realFile: real.file },
    retrieval: stage.retrieval,
    web: stage.web,
    agent: stage.agent,
    verifier: stage.verifier,
    report: stage.report,
    router,
    security: {
      quarantined: stage.web.results.filter((r) => r.outcome === "quarantined").map((r) => ({ source: "web", url: r.url, reason: r.why })),
      ...security,
    },
    transcripts: cli.transcripts,
    tutorials: { evidence: cli.evidence, mcp, metricsYaml: cli.saved },
  };
  return { ...base, flows: flows(base) };
}

export const learnJson = (d: LearnData) => `${JSON.stringify(d, null, 2)}\n`;

if (process.argv[1]?.endsWith("learn-data.ts") && process.argv.includes("--write")) {
  mkdirSync(join(LEARN_JSON, ".."), { recursive: true });
  writeFileSync(LEARN_JSON, learnJson(await recordLearn()));
  process.stdout.write(`wrote ${LEARN_JSON}\n`);
}
