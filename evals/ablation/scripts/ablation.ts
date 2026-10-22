// `bun run eval:ablation -- [--arms A,B,C] [--suite smoke|golden] [--model baseline|<provider:model>] [--dataset id]
//   [--context tokens] [--no-tools] [--results-dir dir] [--data dir] [--answers dir]` (docs/specs/accuracy.md §8.5).
// The scripted baseline runs offline; a real model needs its provider configured (.env), like `aa eval`.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { ablationArgs, ablationCommand } from "../src/index.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const ROOT = join(import.meta.dirname, "..", "..", "..");
const { values } = parseArgs({
  options: {
    arms: { type: "string" },
    suite: { type: "string" },
    model: { type: "string" },
    dataset: { type: "string" },
    context: { type: "string" },
    "no-tools": { type: "boolean" },
    "results-dir": { type: "string" },
    data: { type: "string" },
    answers: { type: "string" },
  },
});
const args = ablationArgs(values, {
  resultsDir: join(ROOT, "evals", "results"),
  dataDir: join(ROOT, "evals", "real", "data"),
  answersDir: join(ROOT, "evals", "real", "answers"),
});
await ablationCommand(args, {
  env: process.env,
  // Evals use the hash embedder (deterministic, no download), as `aa eval` does.
  embedder: hashEmbedder(),
  print: (line) => process.stdout.write(`${line}\n`),
});
