// Retrieval eval (spec §5): indexes each labelled corpus and reports recall@8, MRR and answer-in-context per
// embedder/reranker setting. Real models download on first use (hundreds of MB), so this runs only on command:
//   bun run --filter @agentic-analytics/retrieval eval:retrieval [--embedder hash|<hf model>] [--reranker none|<hf model>]
// Exits 1 when a corpus is below the v0.1 target (recall@8 ≥ 0.85).
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ingest } from "@agentic-analytics/ingest";
import { profileJob } from "@agentic-analytics/profile";
import { Workspace } from "@agentic-analytics/store";
import { parse } from "yaml";
import {
  hashEmbedder,
  indexDocuments,
  type Passage,
  quality,
  type Reranker,
  searchDocuments,
  transformersEmbedder,
  transformersReranker,
} from "../src/index.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const embedderName = opt("--embedder") ?? "hash";
const rerankerName = opt("--reranker") ?? "none";
// Models are cached outside node_modules so a reinstall doesn't re-download hundreds of MB.
const cacheDir = process.env.AA_MODELS_DIR ?? join(homedir(), ".cache", "agentic-analytics", "models");
const embedder = embedderName === "hash" ? hashEmbedder() : transformersEmbedder({ model: embedderName, cacheDir });
const reranker: Reranker | undefined = rerankerName === "none" ? undefined : transformersReranker({ model: rerankerName, cacheDir });

interface Corpus {
  readonly dir: string;
  readonly questions: readonly { q: string; relevant: Passage[] }[];
}
const spec = parse(readFileSync(join(root, "evals/retrieval/questions.yaml"), "utf8")) as { corpora: Record<string, Corpus> };

let failed = false;
const lines = [`embedder: ${embedder.id} · reranker: ${reranker?.id ?? "none (degraded: rerank)"}`];
for (const [name, corpus] of Object.entries(spec.corpora)) {
  const ws = await Workspace.open();
  try {
    const dir = join(root, corpus.dir);
    const files = readdirSync(dir)
      .sort()
      .map((f) => ({ name: f, bytes: new Uint8Array(readFileSync(join(dir, f))) }));
    await profileJob(ws, await ingest(files), { today: "2026-07-01" });
    const t0 = Date.now();
    const summary = await indexDocuments(ws, embedder);
    const indexMs = Date.now() - t0;
    const judged = [];
    let degraded = new Set<string>();
    for (const q of corpus.questions) {
      const r = await searchDocuments(ws, q.q, { embedder, ...(reranker ? { reranker } : {}) });
      degraded = new Set([...degraded, ...r.degraded]);
      judged.push({ q: q.q, relevant: q.relevant, hits: r.hits });
    }
    const m = quality(judged);
    if (m.recall < 0.85) failed = true;
    lines.push(
      `${name}: ${summary.chunks} chunks (stemmer ${summary.stemmer}, fts ${summary.fts}, indexed in ${indexMs} ms) · ` +
        `${m.questions} questions · recall@8 ${m.recall.toFixed(3)} · MRR ${m.mrr.toFixed(3)} · answer-in-context ${m.answerInContext.toFixed(3)}` +
        (degraded.size ? ` · degraded: ${[...degraded].join(", ")}` : ""),
    );
    for (const miss of m.misses) lines.push(`  miss: ${miss.q} → ${miss.missing.map((p) => `${p.file} "${p.contains}"`).join("; ")}`);
  } finally {
    ws.close();
  }
}
process.stdout.write(`${lines.join("\n")}\n`);
process.exitCode = failed ? 1 : 0;
