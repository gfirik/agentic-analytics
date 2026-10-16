// Shared types of the RAG lane (docs/specs/retrieval.md). Retrieval covers documents and emails only: tables are
// never retrieved as text, their numbers come from SQL.

export type RetrievalErrorCode = "MODEL_UNAVAILABLE" | "EMBEDDING_MISMATCH" | "NOT_INDEXED" | "BAD_SPAN" | "FTS_UNAVAILABLE";

export class RetrievalError extends Error {
  constructor(
    readonly code: RetrievalErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "RetrievalError";
  }
}

/** A document or email section as stored in the workspace `sources` table (from ingest + profile). */
export interface SectionInput {
  readonly source_id: string;
  readonly file: string;
  readonly kind: "document" | "email";
  readonly page?: number;
  readonly heading_path: readonly string[];
  /** Offsets of `text` in the page text (PDF) or the whole document text. */
  readonly char_start: number;
  readonly char_end: number;
  readonly text: string;
  readonly email?: { readonly from?: string; readonly to?: string; readonly date?: string; readonly subject?: string };
}

export interface Chunk {
  readonly id: string; // "C1"
  readonly source_id: string;
  readonly page?: number;
  readonly char_start: number;
  readonly char_end: number;
  readonly heading_path: readonly string[];
  /** `[file · section path · date]`: embedded and BM25-indexed with the text, never cited. */
  readonly prefix: string;
  /** The exact source text of the span, so citations quote it verbatim. */
  readonly text: string;
}

export interface Embedder {
  /** Model id plus settings; stored with the index so a query is never embedded by a different model. */
  readonly id: string;
  embed(texts: readonly string[], kind: "query" | "passage"): Promise<number[][]>;
}

export interface Reranker {
  readonly id: string;
  /** One relevance score per document, higher is better. */
  score(query: string, documents: readonly string[]): Promise<number[]>;
}

export interface SearchHit {
  readonly chunk_id: string;
  readonly source_id: string;
  readonly file: string;
  readonly page?: number;
  readonly heading_path: readonly string[];
  readonly char_start: number;
  readonly char_end: number;
  readonly text: string;
  readonly prefix: string;
  /** Final score: reranker score, or the RRF score when degraded. */
  readonly score: number;
  readonly bm25_rank?: number;
  readonly vector_rank?: number;
}

export type Degradation = "rerank" | "bm25";

export interface SearchResult {
  readonly hits: SearchHit[];
  /** Parts of the query flow that were skipped (spec §3): the hits are still valid, just less well ordered. */
  readonly degraded: Degradation[];
}
