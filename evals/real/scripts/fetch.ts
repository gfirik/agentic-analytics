// `bun run --filter @agentic-analytics/eval-real fetch`: downloads and verifies the real-data tier's public files
// into evals/real/data/ (gitignored). Exits 1 on any download or checksum failure.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchDataset, REAL_DATASETS } from "../src/index.ts";

const dir = fileURLToPath(new URL("../data", import.meta.url));
mkdirSync(dir, { recursive: true });
const print = (line: string) => process.stdout.write(`${line}\n`);
let failed = false;
for (const d of REAL_DATASETS) {
  try {
    await fetchDataset(d, {
      fetch: (url) => fetch(url, { headers: { "user-agent": "agentic-analytics-evals (+https://github.com/gfirik/agentic-analytics)" } }),
      read: (name) => (existsSync(join(dir, name)) ? new Uint8Array(readFileSync(join(dir, name))) : undefined),
      write: (name, bytes) => writeFileSync(join(dir, name), bytes),
      print,
    });
  } catch (err) {
    failed = true;
    process.stderr.write(`${d.id}: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
process.exitCode = failed ? 1 : 0;
