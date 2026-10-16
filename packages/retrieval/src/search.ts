// Query flow (retrieval spec §3): BM25 top 50 + vector top 50 → RRF (k = 60) → top 30 reranked → top 8.
// Without a reranker (or when it fails to load) the fused order stands and the result says `degraded: rerank`.
// Hits go to the quarantined extractor, never straight to the planner (security spec).
import type { Workspace } from "@agentic-analytics/store";
import { bm25Top, chunksById, type Filters, loadFts, readMeta, vectorTop } from "./retrieval.sql.ts";
import { rrf } from "./rrf.ts";
import { type Degradation, type Embedder, type Reranker, RetrievalError, type SearchHit, type SearchResult } from "./types.ts";

export interface SearchOptions extends Filters {
  readonly embedder: Embedder;
  readonly reranker?: Reranker;
  /** Results kept (spec: 8). */
  readonly k?: number;
  /** Candidates per lane (spec: 50) and how many fused results are reranked (spec: 30). */
  readonly laneSize?: number;
  readonly rerankSize?: number;
  readonly rrfK?: number;
}

export async function searchDocuments(ws: Workspace, query: string, options: SearchOptions): Promise<SearchResult> {
  const k = options.k ?? 8;
  const lane = options.laneSize ?? 50;
  const meta = await ws.one<{ embedder: string; fts: boolean; chunks: number }>(readMeta);
  if (!meta) throw new RetrievalError("NOT_INDEXED", "documents are not indexed yet: run indexDocuments first");
  if (meta.embedder !== options.embedder.id)
    throw new RetrievalError(
      "EMBEDDING_MISMATCH",
      `index was built with ${meta.embedder}; the query embedder is ${options.embedder.id}. Re-index or use the same model.`,
    );
  const degraded: Degradation[] = [];
  const reasons: Partial<Record<Degradation, string>> = {};
  const degrade = (d: Degradation, reason: string) => {
    degraded.push(d);
    reasons[d] = reason;
  };
  if (meta.chunks === 0) return { hits: [], degraded, reasons };

  const filters: Filters = {
    ...(options.sources ? { sources: options.sources } : {}),
    ...(options.from ? { from: options.from } : {}),
    ...(options.to ? { to: options.to } : {}),
  };
  let bm25: string[] = [];
  if (!meta.fts) degrade("bm25", "the BM25 index was not built (fts extension unavailable when indexing)");
  else {
    try {
      // A reopened job file has the index tables but not the extension loaded in this connection.
      for (const q of loadFts) await ws.run(q);
      bm25 = (await ws.all<{ id: string }>(bm25Top(query, filters, lane))).map((r) => r.id);
    } catch (err) {
      degrade("bm25", err instanceof Error ? err.message : String(err));
    }
  }
  const [qv] = await options.embedder.embed([query], "query");
  const vector = (await ws.all<{ id: string }>(vectorTop(qv ?? [], filters, lane))).map((r) => r.id);

  const fused = rrf([bm25, vector], options.rrfK ?? 60);
  const pool = fused.slice(0, options.rerankSize ?? 30);
  const rows = await ws.all<{
    id: string;
    source_id: string;
    file: string;
    page: number | null;
    heading_path: string[] | null;
    char_start: number;
    char_end: number;
    text: string;
    prefix: string;
  }>(chunksById(pool.map((f) => f.id)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const hit = (id: string, score: number, ranks: readonly (number | undefined)[]): SearchHit | undefined => {
    const r = byId.get(id);
    if (!r) return undefined;
    const [b, v] = ranks;
    return {
      untrusted: true,
      chunk_id: r.id,
      source_id: r.source_id,
      file: r.file,
      ...(r.page !== null ? { page: r.page } : {}),
      heading_path: r.heading_path ?? [],
      char_start: r.char_start,
      char_end: r.char_end,
      text: r.text,
      prefix: r.prefix,
      score,
      ...(b !== undefined ? { bm25_rank: b } : {}),
      ...(v !== undefined ? { vector_rank: v } : {}),
    };
  };

  let ordered = pool.map((f) => ({ ...f, score: f.score }));
  if (options.reranker) {
    try {
      const texts = pool.map((f) => {
        const r = byId.get(f.id);
        return r ? `${r.prefix}\n${r.text}` : "";
      });
      const scores = await options.reranker.score(query, texts);
      if (scores.length !== pool.length)
        throw new RetrievalError(
          "RERANK_FAILED",
          `reranker ${options.reranker.id} returned ${scores.length} scores for ${pool.length} documents`,
        );
      if (scores.some((x) => !Number.isFinite(x)))
        throw new RetrievalError("RERANK_FAILED", `reranker ${options.reranker.id} returned non-finite scores`);
      ordered = pool
        .map((f, i) => ({ ...f, score: scores[i] as number }))
        .sort((a, b) => b.score - a.score || pool.indexOf(a) - pool.indexOf(b));
    } catch (err) {
      // A reranker that can't load or run must not lose the answer: keep the fused order, flag it and keep the
      // reason (spec §3).
      degrade("rerank", err instanceof Error ? err.message : String(err));
    }
  } else degrade("rerank", "no reranker configured");

  const hits = ordered
    .slice(0, k)
    .map((f) => hit(f.id, f.score, f.ranks))
    .filter((h): h is SearchHit => h !== undefined);
  return { hits, degraded, reasons };
}
