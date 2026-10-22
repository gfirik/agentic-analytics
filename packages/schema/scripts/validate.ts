// Validates report JSON files against report v1 (schema + integrity). Usage: tsx scripts/validate.ts <file...>
import { readFileSync } from "node:fs";
import { validateReport } from "../src/index.ts";

let failed = 0;
for (const file of process.argv.slice(2)) {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    // One unreadable file is reported like an invalid one; the files after it are still checked.
    failed++;
    process.stdout.write(`✗ ${file}\n  not readable JSON: ${err instanceof Error ? err.message : String(err)}\n`);
    continue;
  }
  const res = validateReport(json);
  if (res.ok) {
    const r = res.report;
    process.stdout.write(
      `✓ ${file}: valid ${r.schema} — ${r.facts.length} facts, ${r.findings.length} findings, ${r.recommendations.length} recommendations, ${r.sources.length} sources\n`,
    );
  } else {
    failed++;
    process.stdout.write(`✗ ${file}\n${res.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}\n`);
  }
}
process.exit(failed ? 1 : 0);
