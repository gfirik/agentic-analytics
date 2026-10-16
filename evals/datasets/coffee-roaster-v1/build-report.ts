// Regenerates packages/schema/test/fixtures/report.coffee-roaster.json from the dataset ground truth.
// Run: bun run --filter @agentic-analytics/eval-datasets build:golden-report
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateReport } from "@agentic-analytics/schema";
import { goldenReportJson } from "../src/index.ts";

const out = join(import.meta.dirname, "..", "..", "..", "packages", "schema", "test", "fixtures", "report.coffee-roaster.json");
const json = goldenReportJson();
const check = validateReport(JSON.parse(json));
if (!check.ok) {
  process.stderr.write(`golden report is invalid:\n${check.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}\n`);
  process.exit(1);
}
mkdirSync(join(out, ".."), { recursive: true });
writeFileSync(out, json);
process.stdout.write(`wrote ${out}\n`);
