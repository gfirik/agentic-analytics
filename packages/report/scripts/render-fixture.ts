// Renders the golden fixture to out/report.coffee-roaster.html (acceptance demo for M1).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateReport } from "@agentic-analytics/schema";
import { renderReportHtml } from "../src/index.ts";

const root = join(import.meta.dirname, "..");
const fixture = join(root, "..", "schema", "test", "fixtures", "report.coffee-roaster.json");
const res = validateReport(JSON.parse(readFileSync(fixture, "utf8")));
if (!res.ok) {
  process.stderr.write(`fixture is invalid:\n${res.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}\n`);
  process.exit(1);
}
const html = renderReportHtml(res.report);
const out = join(root, "out", "report.coffee-roaster.html");
mkdirSync(join(root, "out"), { recursive: true });
writeFileSync(out, html);
const external = html.match(/\s(?:src|href)="https?:|<link\b|@import|url\(\s*["']?https?:/gi) ?? [];
process.stdout.write(
  `wrote ${out} (${(html.length / 1024).toFixed(1)} KiB, ${res.report.facts.length} facts, ${res.report.findings.length} findings)\n` +
    `external resource references: ${external.length}\n`,
);
