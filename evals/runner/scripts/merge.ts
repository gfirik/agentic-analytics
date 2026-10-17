// Merges the results of runs over parts of a suite (`aa eval --only … --results-dir …`) into one results file in
// evals/results, then rebuilds evals/RESULTS.md. The Kaggle notebook (evals/kaggle/full-suite-vllm.ipynb) runs one
// business per `aa eval` so a session limit never loses a finished one; this publishes them as one model row with the
// real timings (a replay from the response cache would record replay time instead).
//   bun run eval:merge -- --label "<model row name>" [--note "<text>"] [--small-model] [--suite full] [--out evals/results] <part.json>...
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { EvalRunError, evalSlug, mergeResults, resultsPage, type SuiteResult, suiteDatasets } from "../src/index.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    label: { type: "string" },
    note: { type: "string" },
    "small-model": { type: "boolean" },
    suite: { type: "string", default: "full" },
    out: { type: "string", default: join(ROOT, "evals", "results") },
  },
});
const suite = values.suite === "smoke" ? "smoke" : "full";
if (!values.label || !positionals.length)
  throw new EvalRunError(
    "USAGE",
    'usage: merge.ts --label "<name>" [--note "<text>"] [--small-model] [--suite full] [--out dir] <part.json>...',
  );
const parts = positionals.map((f) => JSON.parse(readFileSync(f, "utf8")) as SuiteResult);
// Each part was run in the same mode: its model name carries the small-model suffix when it was on.
const small = values["small-model"] === true;
if (parts.some((p) => p.model.endsWith(" (small-model mode)") !== small))
  throw new EvalRunError("USAGE", `the runs' mode doesn't match --small-model=${small}: ${parts.map((p) => p.model).join(", ")}`);
const merged = mergeResults(parts, {
  suite,
  modelName: values.label + (small ? " (small-model mode)" : ""),
  ...(values.note ? { note: values.note } : {}),
  order: suiteDatasets(suite).map((d) => d.id),
});
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const file = join(out, `${evalSlug(merged.date, { model: "", label: values.label, smallModel: small, suite })}.json`);
writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
// Like aa eval: the page sits beside the results folder (evals/RESULTS.md in a checkout).
writeFileSync(join(dirname(out), "RESULTS.md"), resultsPage(out));
process.stdout.write(`merged ${parts.length} run(s), ${merged.datasets} datasets: ${file}\n`);
