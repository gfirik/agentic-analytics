// Regenerates coffee-roaster-v1/files/ deterministically. Run: bun run --filter @agentic-analytics/eval-datasets build:coffee-roaster
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { coffeeRoasterFiles } from "../src/index.ts";

const dir = join(import.meta.dirname, "files");
mkdirSync(dir, { recursive: true });
for (const [name, data] of Object.entries(coffeeRoasterFiles())) {
  writeFileSync(join(dir, name), data);
  process.stdout.write(`${name}  ${data.length} bytes  sha256=${createHash("sha256").update(data).digest("hex")}\n`);
}
