// M6 acceptance, offline: BM25 + the hashing embedder (no model download) reach recall@8 ≥ 0.85 on both labelled
// corpora, and search works without a reranker (degraded flag). Real-model numbers: `eval:retrieval`.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingest } from "@agentic-analytics/ingest";
import { profileJob } from "@agentic-analytics/profile";
import { sql, Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  findQuote,
  hashEmbedder,
  indexDocuments,
  type Passage,
  quality,
  type Reranker,
  readSections,
  searchDocuments,
} from "../src/index.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const spec = parse(readFileSync(join(root, "evals/retrieval/questions.yaml"), "utf8")) as {
  corpora: Record<string, { dir: string; questions: { q: string; relevant: Passage[] }[] }>;
};
const embedder = hashEmbedder();

async function open(dir: string): Promise<Workspace> {
  const ws = await Workspace.open();
  const files = readdirSync(join(root, dir))
    .sort()
    .map((f) => ({ name: f, bytes: new Uint8Array(readFileSync(join(root, dir, f))) }));
  await profileJob(ws, await ingest(files), { today: "2026-07-01" });
  return ws;
}

const shop = spec.corpora["printing-shop-v1"] as { dir: string; questions: { q: string; relevant: Passage[] }[] };
let ws: Workspace;
beforeAll(async () => {
  ws = await open(shop.dir);
  await indexDocuments(ws, embedder);
}, 120_000);
afterAll(() => ws.close());

describe("recall@8 ≥ 0.85 (ROADMAP M6)", () => {
  for (const [name, corpus] of Object.entries(spec.corpora)) {
    it(`${name}`, async () => {
      const w = name === "printing-shop-v1" ? ws : await open(corpus.dir);
      if (w !== ws) await indexDocuments(w, embedder);
      const judged = [];
      for (const q of corpus.questions)
        judged.push({ q: q.q, relevant: q.relevant, hits: (await searchDocuments(w, q.q, { embedder })).hits });
      const m = quality(judged);
      if (w !== ws) w.close();
      expect(m.misses).toEqual([]);
      expect(m.recall).toBeGreaterThanOrEqual(0.85);
    }, 120_000);
  }
});

describe("query flow (spec §3)", () => {
  it("without a reranker: 8 hits in fused order, degraded: rerank", async () => {
    const r = await searchDocuments(ws, "Why was the night shift stopped?", { embedder });
    expect(r.hits).toHaveLength(8);
    expect(r.degraded).toEqual(["rerank"]);
    expect(r.reasons).toEqual({ rerank: "no reranker configured" });
    expect(r.hits.every((h) => h.untrusted)).toBe(true);
    const scores = r.hits.map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(r.hits.every((h) => h.bm25_rank !== undefined || h.vector_rank !== undefined)).toBe(true);
  });

  it("a reranker reorders the fused top 30 and clears the flag", async () => {
    // Scripted reranker: prefers the HR notes, so they must come first whatever the fused order was.
    const reranker: Reranker = {
      id: "fake",
      score: async (_q, docs) => docs.map((d) => (d.includes("hr-notes.txt") ? 10 : 0)),
    };
    const r = await searchDocuments(ws, "Why was the night shift stopped?", { embedder, reranker });
    expect(r.degraded).toEqual([]);
    expect(r.hits[0]?.file).toBe("hr-notes.txt");
    expect(r.hits[0]?.score).toBe(10);
  });

  it("a reranker that fails keeps the fused order and says so", async () => {
    const broken: Reranker = {
      id: "broken",
      score: async () => {
        throw new Error("model file missing");
      },
    };
    const plain = await searchDocuments(ws, "rent increase", { embedder });
    const r = await searchDocuments(ws, "rent increase", { embedder, reranker: broken });
    expect(r.degraded).toEqual(["rerank"]);
    expect(r.reasons.rerank).toBe("model file missing");
    expect(r.hits.map((h) => h.chunk_id)).toEqual(plain.hits.map((h) => h.chunk_id));
  });

  it("a reranker returning the wrong number of scores is rejected, not padded", async () => {
    const short: Reranker = { id: "short", score: async () => [1, 2, 3] };
    const plain = await searchDocuments(ws, "rent increase", { embedder });
    const r = await searchDocuments(ws, "rent increase", { embedder, reranker: short });
    expect(r.degraded).toEqual(["rerank"]);
    expect(r.reasons.rerank).toMatch(/returned 3 scores for \d+ documents/);
    expect(r.hits.map((h) => h.chunk_id)).toEqual(plain.hits.map((h) => h.chunk_id));
  });

  it("non-finite reranker scores are rejected with their own reason", async () => {
    const nan: Reranker = { id: "nan", score: async (_q, docs) => docs.map(() => Number.NaN) };
    const r = await searchDocuments(ws, "rent increase", { embedder, reranker: nan });
    expect(r.reasons.rerank).toBe("reranker nan returned non-finite scores");
  });

  it("a reopened job file still has BM25 (the fts extension is loaded per connection)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-retrieval-"));
    const path = join(dir, "job.duckdb");
    try {
      const first = await Workspace.open(path);
      const files = readdirSync(join(root, shop.dir))
        .sort()
        .map((f) => ({ name: f, bytes: new Uint8Array(readFileSync(join(root, shop.dir, f))) }));
      await profileJob(first, await ingest(files), { today: "2026-07-01" });
      await indexDocuments(first, embedder);
      first.close();
      const again = await Workspace.open(path);
      const r = await searchDocuments(again, "minimum paper order per delivery", { embedder });
      again.close();
      expect(r.degraded).toEqual(["rerank"]);
      expect(r.hits.some((h) => h.bm25_rank !== undefined)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("filters by file and by email date", async () => {
    const byFile = await searchDocuments(ws, "price increase", { embedder, sources: ["email-paperworks.eml", "pricing-memo.docx"] });
    expect(new Set(byFile.hits.map((h) => h.file))).toEqual(new Set(["email-paperworks.eml", "pricing-memo.docx"]));
    const june = await searchDocuments(ws, "catalogue", { embedder, from: "2026-06-01", to: "2026-06-30" });
    expect(june.hits.length).toBeGreaterThan(0);
    // only dated (email) chunks from June can pass a date filter
    for (const h of june.hits) expect(h.prefix).toMatch(/· 2026-06-\d\d\]$/);
    // Dates compare as dates: a one-day window still finds that day's email, and an impossible day matches nothing
    // (never a DuckDB conversion error).
    const day = june.hits[0]?.prefix.match(/(2026-06-\d\d)\]$/)?.[1] as string;
    const oneDay = await searchDocuments(ws, "catalogue", { embedder, from: day, to: day });
    expect(oneDay.hits.length).toBeGreaterThan(0);
    const impossible = await searchDocuments(ws, "catalogue", { embedder, from: "2026-13-45" });
    expect(impossible.hits).toEqual([]);
  });

  it("never returns a quarantined source, even when asked for it by name (security §3)", async () => {
    const memo = await ws.all<{ id: string }>(
      sql`SELECT s.id FROM sources s JOIN files f ON f.id = s.file_id WHERE f.name = 'pricing-memo.docx'`,
    );
    expect(memo.length).toBeGreaterThan(0);
    const before = await searchDocuments(ws, "price increase", { embedder });
    expect(before.hits.some((h) => h.file === "pricing-memo.docx")).toBe(true);
    // Both paths ran (BM25 didn't fall back), so both are shown to filter.
    expect(before.degraded).not.toContain("bm25");
    for (const m of memo) await ws.run(sql`INSERT INTO quarantine VALUES (${m.id}, 'test', 'screen')`);
    try {
      const after = await searchDocuments(ws, "price increase", { embedder });
      expect(after.hits.some((h) => h.file === "pricing-memo.docx")).toBe(false);
      // Its slots go to other evidence, not to nothing.
      expect(after.hits.length).toBe(before.hits.length);
      const asked = await searchDocuments(ws, "price increase", { embedder, sources: ["pricing-memo.docx"] });
      expect(asked.hits).toEqual([]);
    } finally {
      await ws.run(sql`DELETE FROM quarantine WHERE reason = 'test'`);
    }
  });

  it("emails carry sender, recipient and date in the prefix", async () => {
    const r = await searchDocuments(ws, "catalogue print run moved to another printer", { embedder });
    const hit = r.hits.find((h) => h.file === "email-brightads.eml");
    expect(hit?.prefix).toBe(
      "[email-brightads.eml · from Lena Park, BrightAds <lena@brightads.example> · to orders@inkwell.example · Catalogue print run · 2026-05-21]",
    );
  });

  it("hits quote their source verbatim at the stored offsets", async () => {
    const sections = await readSections(ws);
    const r = await searchDocuments(ws, "minimum paper order per delivery", { embedder });
    for (const h of r.hits) {
      const s = sections.find((x) => x.source_id === h.source_id);
      expect(s?.text.slice(h.char_start - (s?.char_start ?? 0), h.char_end - (s?.char_start ?? 0))).toBe(h.text);
    }
    const q = r.hits.map((h) => findQuote(h, "minimum order is 20 reams")).find(Boolean);
    expect(q).toMatchObject({ quote: "minimum order is 20 reams", page: 2 });
  });

  it("refuses a query embedder that differs from the index's, and an unindexed job", async () => {
    await expect(searchDocuments(ws, "x", { embedder: hashEmbedder(256) })).rejects.toMatchObject({ code: "EMBEDDING_MISMATCH" });
    const empty = await Workspace.open();
    await expect(searchDocuments(empty, "x", { embedder })).rejects.toMatchObject({ code: "NOT_INDEXED" });
    empty.close();
  });

  it("without the BM25 index, vector search alone answers and says degraded: bm25", async () => {
    const w = await open(shop.dir);
    await indexDocuments(w, embedder);
    await w.run(sql`UPDATE retrieval_meta SET fts = false`);
    const r = await searchDocuments(w, "How much will the workshop rent increase?", { embedder });
    w.close();
    expect(r.degraded).toEqual(["bm25", "rerank"]);
    expect(r.reasons.bm25).toMatch(/not built/);
    expect(r.hits.some((h) => h.file === "email-landlord.eml")).toBe(true);
    expect(r.hits.every((h) => h.bm25_rank === undefined)).toBe(true);
  }, 60_000);

  it("stores chunks with embeddings and the index settings", async () => {
    const meta = await ws.one<{ embedder: string; dims: number; stemmer: string; fts: boolean; chunks: number }>(
      sql`SELECT * FROM retrieval_meta`,
    );
    expect(meta).toMatchObject({ embedder: "hash-ngram-1024", dims: 1024, stemmer: "english", fts: true });
    const n = await ws.one<{ n: number }>(sql`SELECT count(*) AS n FROM chunks WHERE len(embedding) = 1024`);
    expect(n?.n).toBe(meta?.chunks);
  });
});
