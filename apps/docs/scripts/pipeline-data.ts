// The data behind the animated pipeline (README GIF and the docs <Pipeline /> island): one real, web-enabled run
// of the engine on examples/coffee-roaster with the scripted planner (no LLM), the offline web fixture and the hash
// embedder. Nothing on screen is typed by hand: the stage order comes from the run's event log, every number is a
// fact of the verified report (id, value, computation), every quote is a citation the verifier kept, and the V1–V8
// rows are the verifier's own check table. Formatting is presentation only (AGENTS.md §2.1).
//   tsx apps/docs/scripts/pipeline-data.ts --write   → docs/assets/readme/pipeline.json (checked in)
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJob } from "@agentic-analytics/core";
import { coffeePlanner, coffeeWeb } from "@agentic-analytics/core/testing";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import type { JobEvent, Report } from "@agentic-analytics/schema";
import { sql, Workspace } from "@agentic-analytics/store";
import { type FactLike, formatFact } from "../src/components/format.ts";
import type { PipelineData, ShownFact } from "../src/components/pipeline-scene.ts";

export const PIPELINE_JSON = join(import.meta.dirname, "..", "..", "..", "docs", "assets", "readme", "pipeline.json");

type Fact = Report["facts"][number];
type Claim = Report["findings"][number]["claims"][number];

export class PipelineDataError extends Error {
  readonly code = "PIPELINE_DATA";
}

const need = <T>(v: T | undefined | null, what: string): T => {
  if (v === undefined || v === null) throw new PipelineDataError(`pipeline data: ${what} not found in the run`);
  return v;
};

/** A fact as shown: its id, its stored value and a reading of it (currency gets its symbol; the value is untouched). */
export function shown(f: Fact): ShownFact {
  const text = formatFact(f as FactLike);
  const money = f.unit === "currency" && f.currency === "USD";
  return { id: f.id, value: f.value, label: f.label, text: money ? text.replace(/^(−?)/, "$1$") : text };
}

export interface RunRecord {
  readonly events: readonly JobEvent[];
  readonly report: Report;
  /** The verifier's check table (`verification`): one row per check run. */
  readonly checks: readonly { readonly check_name: string; readonly passed: boolean }[];
}

/** Pure: the run's events, verified report and check rows → what the animation shows. */
export function extractPipelineData(run: RunRecord): PipelineData {
  const { report, events } = run;
  const facts = new Map(report.facts.map((f) => [f.id, f]));
  const fact = (id: string | undefined, what: string) => need(id ? facts.get(id) : undefined, what);
  const sources = new Map(report.sources.map((s) => [s.id, s]));

  // Stages in the order the run reported them; a stage with no events was skipped.
  const ran = events.filter((e) => e.type === "stage_completed").map((e) => (e as { stage: string }).stage);

  const files = [...new Map(report.sources.filter((s) => !s.external).map((s) => [s.file, s.kind])).entries()].map(([name, kind]) => ({
    name,
    kind,
  }));

  // The top-ranked finding and its first claim: from, to, change, change % (in the claim's own order).
  const top = need(report.findings[0], "a finding");
  const head = need(top.claims[0], "the headline claim");
  const byFn = (fn: string) =>
    fact(
      head.facts.find((id) => facts.get(id)?.computation.fn === fn),
      `the headline ${fn} fact`,
    );
  const sqlFacts = head.facts.map((id) => fact(id, id)).filter((f) => f.computation.kind === "sql");
  const metric = need(
    report.metrics.find((m) => m.id === sqlFacts[0]?.metric_id),
    "the headline metric",
  );

  // The top-ranked action, its rationale's share fact (the driver) and the delta that share is computed from.
  const rec = need(report.recommendations[0], "a recommendation");
  const share = fact(rec.rationale[0]?.facts[0], "the driver share fact");
  const driverDelta = fact(share.computation.inputs?.[0], "the driver delta fact");
  const by = need(/ by (\w+):share:(.+)$/.exec(share.label), "the driver dimension");

  // Every cited quote in the top finding, plus the web lane's quote wherever the verifier kept it.
  const cites = (claims: readonly Claim[]) =>
    claims.flatMap((c) => c.citations.filter((x) => x.quote).map((x) => ({ claim: c, cite: x, src: sources.get(x.source_id) })));
  const docQuotes = cites(top.claims)
    .filter((q) => q.src && !q.src.external)
    .map((q) => {
      const s = need(q.src, "a cited source");
      const at = "page" in s.locator && s.locator.page ? `p.${s.locator.page}` : "section" in s.locator ? String(s.locator.section) : "";
      return { source_id: s.id, file: s.file, kind: s.kind, at, quote: need(q.cite.quote, "a quote"), grade: q.claim.causal_grade ?? null };
    });
  const webQ = cites(report.findings.flatMap((f) => f.claims)).find((q) => q.src?.external);
  const web = webQ
    ? {
        source_id: need(webQ.src, "web source").id,
        url: need(webQ.src, "web source").file,
        quote: need(webQ.cite.quote, "web quote"),
        gap: shown(fact(webQ.claim.facts[0], "the benchmark gap fact")),
      }
    : null;

  const names: Record<string, string> = {
    V1: "placeholders",
    V2: "recompute",
    V3: "re-derive",
    V4: "definitions",
    V5: "citations",
    V6: "causal",
    V7: "grounding",
    V8: "external",
  };
  const checks = Object.keys(names).map((check) => {
    const rows = run.checks.filter((c) => c.check_name === check);
    return { check, name: names[check] ?? check, run: rows.length, failed: rows.filter((r) => !r.passed).length };
  });

  const fill = (text: string) => text.replace(/\{\{(N\d+)\}\}/g, (_m, id: string) => shown(fact(id, id)).text);
  const impact = need(rec.impact, "the action's impact");
  return {
    run: {
      example: "examples/coffee-roaster",
      model: "scripted planner (coffeePlanner), no LLM",
      web: "offline web fixture (coffeeWeb)",
      events: events.length,
    },
    stages: ran,
    files,
    profile: {
      tables: report.sources.filter((s) => s.kind === "table").length,
      sections: report.sources.filter((s) => !s.external && s.kind !== "table").length,
      issues: report.data_quality.length,
    },
    metric: {
      id: metric.id,
      label: metric.label,
      formula: metric.expression ? `${metric.type} of ${metric.expression}` : metric.type,
      grain: report.period.grain,
      currency: metric.currency ?? null,
      status: metric.status,
    },
    change: {
      metric: metric.label,
      fromPeriod: need(/(\d{4}-\d{2})$/.exec(sqlFacts[0]?.label ?? "")?.[1], "the headline base period"),
      from: shown(sqlFacts[0] ?? byFn("delta")),
      to: shown(sqlFacts[1] ?? byFn("delta")),
      delta: shown(byFn("delta")),
      pct: shown(byFn("pct_change")),
      period: need(/(\d{4}-\d{2})$/.exec(sqlFacts[1]?.label ?? "")?.[1], "the headline period"),
    },
    driver: { dimension: need(by[1], "dimension"), member: need(by[2], "member"), delta: shown(driverDelta), share: shown(share) },
    docs: docQuotes,
    web,
    checks,
    verification: {
      numbers_checked: report.verification.numbers_checked,
      numbers_mismatched: report.verification.numbers_mismatched,
      citations_checked: report.verification.citations_checked,
      claims_dropped: report.verification.claims_dropped.length,
      claims_downgraded: report.verification.claims_downgraded.length,
    },
    headline: fill(report.summary.headline),
    action: {
      id: rec.id,
      rank: 1,
      of: report.recommendations.length,
      text: rec.action,
      low: shown(fact(impact.low, "impact low")),
      high: shown(fact(impact.high, "impact high")),
      horizon: impact.horizon,
      confidence: rec.confidence,
      check: `${rec.check.metric_id} ${rec.check.comparator} ${shown(fact(rec.check.threshold, "check threshold")).text} by ${rec.check.by}`,
    },
  };
}

/** Runs the engine once (offline, deterministic) and records what the animation needs. */
export async function recordRun(): Promise<RunRecord> {
  const dir = mkdtempSync(join(tmpdir(), "aa-pipeline-"));
  try {
    const events: JobEvent[] = [];
    const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
    const web = coffeeWeb();
    const out = await runJob(
      { dir, jobId: "coffee-demo", files, options: { today: "2026-07-01", currency: "USD", web: true } },
      {
        model: coffeePlanner({ web: true }),
        embedder: hashEmbedder(),
        web: { provider: web.provider, fetchPage: web.fetchPage },
        onEvent: (e) => events.push(e),
        now: () => new Date("2026-07-01T09:00:00Z"),
      },
    );
    const ws = await Workspace.open(join(dir, "job.duckdb"));
    try {
      const checks = await ws.all<{ check_name: string; passed: boolean }>(sql`SELECT check_name, passed FROM verification ORDER BY id`);
      return { events, report: out.report, checks };
    } finally {
      ws.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const pipelineJson = (d: PipelineData) => `${JSON.stringify(d, null, 2)}\n`;

if (process.argv[1]?.endsWith("pipeline-data.ts") && process.argv.includes("--write")) {
  writeFileSync(PIPELINE_JSON, pipelineJson(extractPipelineData(await recordRun())));
  process.stdout.write(`wrote ${PIPELINE_JSON}\n`);
}
