// `bun run --filter @agentic-analytics/eval-real fetch`: downloads and verifies the real-data tier's public files
// into evals/real/data/ (gitignored). Exits 1 on any download, licence or checksum failure. A pending dataset (no
// pinned file yet) is only probed: an unreachable one prints DEFERRED and does not fail the run.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchDataset, fetchFailure, PENDING_DATASETS, probePending, REAL_DATASETS } from "../src/index.ts";

const dir = fileURLToPath(new URL("../data", import.meta.url));
mkdirSync(dir, { recursive: true });
const print = (line: string) => process.stdout.write(`${line}\n`);
const get = (url: string) =>
  fetch(url, { headers: { "user-agent": "agentic-analytics-evals (+https://github.com/gfirik/agentic-analytics)" } });
let failed = false;
for (const d of REAL_DATASETS) {
  try {
    await fetchDataset(d, {
      fetch: get,
      read: (name) => (existsSync(join(dir, name)) ? new Uint8Array(readFileSync(join(dir, name))) : undefined),
      write: (name, bytes) => writeFileSync(join(dir, name), bytes),
      print,
    });
  } catch (err) {
    failed = true;
    process.stderr.write(`${d.id}: ${fetchFailure(err)}\n`);
  }
}
for (const d of PENDING_DATASETS) {
  try {
    await probePending(d, { fetch: get, print });
  } catch (err) {
    failed = true;
    process.stderr.write(`${d.id}: ${fetchFailure(err)}\n`);
  }
}
process.exitCode = failed ? 1 : 0;
