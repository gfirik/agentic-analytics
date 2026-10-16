// Writes every generated dataset to evals/datasets/generated/<id>/: the files (gitignored, rebuilt on demand) and
// answers.yaml (versioned, so answer-key changes show up in review). Also refreshes the manifest of file hashes.
//   bun run --filter @agentic-analytics/eval-generator build:datasets
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { answersYaml, generatedDatasets, manifest } from "../src/index.ts";

const root = join(import.meta.dirname, "..", "..", "datasets", "generated");
const all = generatedDatasets();
for (const ds of all) {
  const dir = join(root, ds.id);
  mkdirSync(join(dir, "files"), { recursive: true });
  for (const [name, bytes] of Object.entries(ds.files)) writeFileSync(join(dir, "files", name), bytes);
  writeFileSync(join(dir, "answers.yaml"), answersYaml(ds.answers));
}
writeFileSync(join(import.meta.dirname, "..", "manifest.json"), `${JSON.stringify(manifest(all), null, 2)}\n`);
process.stdout.write(`${all.length} datasets in ${root}\n`);
