// Ingest → profile → metrics (deterministic drafts, assumed) → analysis; prints the ranked findings with their
// facts. Usage (repo root): bun run analyze <path…> [--today YYYY-MM-DD] [--currency CODE]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ingest } from "@agentic-analytics/ingest";
import { fallbackMetrics, loadCatalog, validateMetrics } from "@agentic-analytics/metrics";
import { periodOf, profileJob } from "@agentic-analytics/profile";
import type { Fact } from "@agentic-analytics/schema";
import { Workspace } from "@agentic-analytics/store";
import { analyzeJob } from "../src/index.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const today = opt("--today") ?? new Date().toISOString().slice(0, 10);
const currency = opt("--currency");
const paths = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")).map((p) => resolve(process.cwd(), p));
const collect = (p: string): string[] =>
  statSync(p).isDirectory()
    ? readdirSync(p)
        .sort()
        .flatMap((n) => collect(join(p, n)))
    : [p];

const ws = await Workspace.open();
try {
  const summary = await profileJob(
    ws,
    await ingest(paths.flatMap(collect).map((p) => ({ name: basename(p), bytes: new Uint8Array(readFileSync(p)) }))),
    { today },
  );
  const catalog = await loadCatalog(ws);
  const defs = validateMetrics(fallbackMetrics(summary), catalog, currency ? { defaultCurrency: currency } : {}).accepted;
  const periods = summary.tables
    .flatMap((t) => (t.date_first && t.date_last ? [periodOf(t.date_first, summary.grain), periodOf(t.date_last, summary.grain)] : []))
    .sort();
  const result = await analyzeJob(ws, defs, catalog, {
    from: periods[0] ?? "",
    to: periods[periods.length - 1] ?? "",
    grain: summary.grain,
  });
  const facts = new Map(result.facts.map((f) => [f.id, f]));
  const show = (id: string | undefined) => {
    const f: Fact | undefined = id ? facts.get(id) : undefined;
    if (!f) return "?";
    // One format for every number: grouped, at most 2 decimals, and never "-0" from rounding.
    const n = Number(f.value.toFixed(2)) || 0;
    const v = n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    return `${v}${f.unit === "percent" ? "%" : ""} [${f.id}]`;
  };
  const out: string[] = [
    `metrics: ${defs.map((d) => d.id).join(", ")}`,
    `facts: ${result.facts.length} · insights: ${result.insights.length} · decompositions: ${result.decompositions.length}`,
    "",
    "top findings (to EXPLAIN):",
  ];
  for (const [k, id] of result.top.entries()) {
    const i = result.insights.find((x) => x.id === id);
    if (!i) continue;
    const roles = Object.entries(i.facts)
      .map(([role, fid]) => `${role} ${show(fid)}`)
      .join(" · ");
    const group = result.topScores[k] ?? i.score;
    out.push(
      `  ${i.id} ${i.template} ${i.series} @ ${i.period} (${i.confidence}, score ${i.score.toFixed(4)}, event score ${group.toFixed(4)})`,
    );
    out.push(`      ${roles}`);
    for (const d of result.decompositions.filter((x) => x.insight === i.id)) {
      out.push(
        `      ${d.method} by ${d.dimension}: ${Object.entries(d.facts)
          .map(([k, fid]) => `${k} ${show(fid)}`)
          .join(" · ")}`,
      );
    }
  }
  if (result.openQuestions.length) out.push("", "open questions:", ...result.openQuestions.map((q) => `  - ${q}`));
  const march = result.facts.find((f) => f.computation.kind === "sql");
  if (march)
    out.push(
      "",
      `example fact ${march.id} (${march.label}):`,
      `  sql: ${march.computation.sql?.replace(/\s+/g, " ").slice(0, 200)}…`,
      `  params: ${JSON.stringify(march.computation.params)}`,
      `  cites: ${march.citations.map((c) => `${c.source_id} rows ${c.rows?.slice(0, 5).join(",")}…`).join("; ")}`,
    );
  process.stdout.write(`${out.join("\n")}\n`);
} finally {
  ws.close();
}
