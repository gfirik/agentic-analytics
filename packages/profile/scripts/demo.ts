// Ingest + profile files into a temporary workspace and print the profile summary.
// Usage (repo root): bun run profile <path…> [--json] [--today YYYY-MM-DD]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { type InputFile, ingest } from "@agentic-analytics/ingest";
import { Workspace } from "@agentic-analytics/store";
import { profileJob } from "../src/index.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const todayAt = args.indexOf("--today");
const today = todayAt >= 0 ? (args[todayAt + 1] ?? "") : new Date().toISOString().slice(0, 10);
const paths = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--today").map((p) => resolve(process.cwd(), p));
const collect = (p: string): string[] =>
  statSync(p).isDirectory()
    ? readdirSync(p)
        .sort()
        .flatMap((n) => (n === "expected" ? [] : collect(join(p, n))))
    : [p];
const inputs: InputFile[] = paths.flatMap(collect).map((p) => ({ name: basename(p), bytes: new Uint8Array(readFileSync(p)) }));

const ws = await Workspace.open();
try {
  const ingested = await ingest(inputs);
  const files = ingested.files;
  const summary = await profileJob(ws, ingested, { today });
  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    const out: string[] = [];
    for (const t of summary.tables) {
      out.push(
        `${t.name}  ${t.file}${t.sheet ? `#${t.sheet}` : ""}!${t.range}  ${t.detail_rows} rows${t.total_rows ? ` + ${t.total_rows} total` : ""}${t.date_column ? `  dates ${t.date_first}…${t.date_last} (${t.grain})` : ""}${t.missing_periods.length ? `  missing ${t.missing_periods.join(",")}` : ""}${t.duplicate_rows ? `  ${t.duplicate_rows} duplicate rows` : ""}`,
      );
      for (const c of t.columns) {
        out.push(
          `    ${c.name.padEnd(18)} ${`${c.type}${c.currency ? `:${c.currency}` : ""}`.padEnd(12)} nulls ${c.null_pct.toFixed(1).padStart(5)}%  distinct ${String(c.distinct_count).padStart(5)}  ${c.min_value ?? ""} … ${c.max_value ?? ""}${c.outlier_rows.length ? `  outliers ${c.outlier_rows.length}` : ""}`,
        );
      }
    }
    const fileOf = (id?: string) => (id ? (files.find((f) => f.id === id)?.name ?? id) : "");
    out.push(`issues (${summary.issues.length})`);
    for (const i of summary.issues)
      out.push(
        `  ${i.id.padEnd(4)} ${i.severity.padEnd(6)} ${i.kind.padEnd(22)} ${fileOf(i.file_id)}${i.sheet ? `#${i.sheet}` : ""}${i.cell || i.rows?.length ? "!" : ""}${i.cell ?? (i.rows?.length ? `rows ${i.rows.slice(0, 3).join(",")}${i.rows.length > 3 ? "…" : ""}` : "")} — ${i.message}`,
      );
    out.push(`entities (${summary.entities.length})`);
    for (const e of summary.entities) {
      const variants = e.links.map((l) => `${l.raw_value} (${l.confidence})`).join(", ");
      out.push(`  ${e.id.padEnd(4)} ${e.kind.padEnd(9)} ${e.canonical_name}${e.links.length > 1 ? `  ← ${variants}` : ""}`);
    }
    out.push(`assumptions (${summary.assumptions.length})`);
    for (const a of summary.assumptions) out.push(`  ${a.kind}: ${a.text}`);
    process.stdout.write(`${out.join("\n")}\n`);
  }
} finally {
  ws.close();
}
