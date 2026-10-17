// Merges the results of runs over parts of a suite (`aa eval --only … --results-dir …`) into one results file in
// evals/results, then rebuilds evals/RESULTS.md. The Kaggle notebook (evals/kaggle/full-suite-vllm.ipynb) runs one
// business per `aa eval` so a session limit never loses a finished one; this publishes them as one model row with the
// real timings (a replay from the response cache would record replay time instead). Checks: mergeChunks.
//   bun run eval:merge -- --label "<model row name>" [--note "<text>"] [--small-model] [--suite full] [--out evals/results] <part.json>...
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { EvalRunError, evalSlug, mergeChunks, resultsPage, type SuiteResult } from "../src/index.ts";

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
if (!values.label || !positionals.length)
  throw new EvalRunError(
    "USAGE",
    'usage: merge.ts --label "<name>" [--note "<text>"] [--small-model] [--suite full] [--out dir] <part.json>...',
  );
const small = values["small-model"] === true;
const merged = mergeChunks(
  { label: values.label, suite: values.suite, smallModel: small, ...(values.note ? { note: values.note } : {}) },
  positionals.map((f) => JSON.parse(readFileSync(f, "utf8")) as SuiteResult),
);
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const file = join(out, `${evalSlug(merged.date, { model: "", label: values.label, smallModel: small, suite: merged.suite })}.json`);
writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
// Like aa eval: the page sits beside the results folder (evals/RESULTS.md in a checkout).
writeFileSync(join(dirname(out), "RESULTS.md"), resultsPage(out));
process.stdout.write(`merged ${positionals.length} run(s), ${merged.datasets} datasets: ${file}\n`);
