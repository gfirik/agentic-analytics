// Re-scores a published results file from the reports kept with `aa eval --keep-reports`, then rebuilds
// RESULTS.md. Used after a scoring fix; the model is not called again.
//   tsx evals/runner/scripts/rescore.ts <results.json> <reports dir> [note to append]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Report } from "@agentic-analytics/schema";
import { EvalRunError, rescore, resultsPage, type SuiteResult } from "../src/index.ts";

const [file, dir, note] = process.argv.slice(2);
if (!file || !dir) throw new EvalRunError("USAGE", "usage: rescore.ts <results.json> <reports dir> [note]");
const reports = new Map<string, Report>(
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, f), "utf8")) as Report])
    : [],
);
const before = JSON.parse(readFileSync(file, "utf8")) as SuiteResult;
const after = rescore(before, reports);
const withNote = note ? { ...after, note: [after.note, note].filter(Boolean).join(" ") } : after;
writeFileSync(file, `${JSON.stringify(withNote, null, 2)}\n`);
// Checkout-only tooling: results live in evals/results, so the page is evals/RESULTS.md (the runner default).
writeFileSync(join(dirname(file), "..", "RESULTS.md"), resultsPage(dirname(file)));
process.stdout.write(`rescored ${reports.size} report(s) in ${file}\n`);
