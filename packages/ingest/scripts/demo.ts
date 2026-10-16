// Ingests files or directories and prints what came out: files, tables, sections, issues.
// Usage (repo root): bun run ingest <path...>   (DOCLING_URL enables the Docling path)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createDoclingClient, type InputFile, ingest } from "../src/index.ts";

const cwd = process.cwd();
const paths = process.argv.slice(2).map((p) => resolve(cwd, p));
const collect = (p: string): string[] =>
  statSync(p).isDirectory()
    ? readdirSync(p)
        .sort()
        .flatMap((n) => (n === "expected" ? [] : collect(join(p, n))))
    : [p];
const inputs: InputFile[] = paths.flatMap(collect).map((p) => ({ name: basename(p), bytes: new Uint8Array(readFileSync(p)) }));
const res = await ingest(inputs, process.env.DOCLING_URL ? { docling: createDoclingClient(process.env.DOCLING_URL) } : {});

const out: string[] = [];
out.push(`files (${res.files.length})`);
for (const f of res.files)
  out.push(`  ${f.id.padEnd(4)} ${f.status.padEnd(9)} ${f.kind.padEnd(7)} ${f.name}${f.parent ? `  (attachment of ${f.parent})` : ""}`);
out.push(`tables (${res.tables.length})`);
for (const t of res.tables) {
  const file = res.files.find((f) => f.id === t.file_id)?.name;
  const totals = t.rows.filter((r) => r.is_total).length;
  out.push(
    `  ${t.id.padEnd(4)} ${file}${t.sheet ? `#${t.sheet}` : ""}!${t.range}  ${t.rows.length} rows${totals ? ` (${totals} total)` : ""}${t.transposed ? "  transposed→long" : ""}${t.hidden_sheet ? "  [hidden sheet]" : ""}`,
  );
  out.push(`        columns: ${t.columns.map((c) => c.name).join(" | ")}`);
  if (t.notes.length) out.push(`        notes: ${t.notes.join(" / ")}`);
}
out.push(`document sections (${res.documents.length})`);
for (const d of res.documents) {
  const file = res.files.find((f) => f.id === d.file_id)?.name;
  const where = `${d.page ? `p.${d.page} ` : ""}chars ${d.char_start}–${d.char_end}`;
  out.push(
    `  ${d.id.padEnd(4)} ${file} ${where}${d.heading_path.length ? ` § ${d.heading_path.join(" › ")}` : ""}: ${JSON.stringify(d.text.slice(0, 60))}`,
  );
}
out.push(`issues (${res.issues.length})`);
for (const i of res.issues)
  out.push(
    `  ${i.severity.padEnd(6)} ${i.kind.padEnd(20)} ${i.file}${i.sheet ? `#${i.sheet}` : ""}${i.cell ? `!${i.cell}` : ""} — ${i.message}`,
  );
process.stdout.write(`${out.join("\n")}\n`);
