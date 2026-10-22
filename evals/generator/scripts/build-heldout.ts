// Writes the held-out generated set to evals/datasets/heldout/<id>/ (docs/specs/accuracy.md §9): the files
// (gitignored, rebuilt on demand) and answers.yaml (versioned), and refreshes heldout-manifest.json. Kept apart from
// build:datasets so a development build never writes the held-out keys.
//   bun run --filter @agentic-analytics/eval-generator build:heldout
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { answersYaml, heldoutDatasets, manifest } from "../src/index.ts";

const root = join(import.meta.dirname, "..", "..", "datasets", "heldout");
const all = heldoutDatasets();
for (const ds of all) {
  const dir = join(root, ds.id);
  mkdirSync(join(dir, "files"), { recursive: true });
  for (const [name, bytes] of Object.entries(ds.files)) writeFileSync(join(dir, "files", name), bytes);
  writeFileSync(join(dir, "answers.yaml"), answersYaml(ds.answers));
}
writeFileSync(join(import.meta.dirname, "..", "heldout-manifest.json"), `${JSON.stringify(manifest(all), null, 2)}\n`);
process.stdout.write(`${all.length} held-out datasets in ${root}\n`);
