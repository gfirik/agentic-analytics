// Writes the injection fixtures (security spec §8) to evals/injection/fixtures/<id>/ so they can be inspected or
// used by hand. The suite itself builds them from code (evals/datasets/src/injection.ts) and runs in
// packages/core/test/injection.test.ts. Run: bun run --filter @agentic-analytics/eval-datasets build:injection
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { injectionFixtures } from "../datasets/src/index.ts";

const root = join(import.meta.dirname, "fixtures");
for (const fx of injectionFixtures()) {
  const dir = join(root, fx.id);
  mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(fx.files)) writeFileSync(join(dir, name), bytes);
  if (fx.page) writeFileSync(join(dir, "page.html"), fx.page);
  writeFileSync(
    join(dir, "fixture.json"),
    `${JSON.stringify({ id: fx.id, description: fx.description, phrase: fx.phrase, flagged: fx.flagged }, null, 2)}\n`,
  );
  process.stdout.write(`${fx.id}: ${fx.description}\n`);
}
