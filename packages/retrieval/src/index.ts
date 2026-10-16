// Public API of @agentic-analytics/retrieval (docs/specs/retrieval.md).
export { type ChunkOptions, chunkSections, chunkSpans, estimateTokens, prefixOf } from "./chunk.ts";
export { findQuote, MAX_QUOTE, type Quote, quoteFor } from "./cite.ts";
export { DEFAULT_EMBEDDING_MODEL, hashEmbedder, type TransformersOptions, transformersEmbedder } from "./embed.ts";
export { chooseStemmer, type IndexOptions, type IndexSummary, indexDocuments, readSections } from "./index-job.ts";
export { type Judged, type Passage, type Quality, quality } from "./quality.ts";
export { DEFAULT_RERANK_MODEL, type RerankOptions, transformersReranker } from "./rerank.ts";
export type { Filters, Stemmer } from "./retrieval.sql.ts";
export { type Fused, rrf } from "./rrf.ts";
export { type SearchOptions, searchDocuments } from "./search.ts";
export {
  type Chunk,
  type Degradation,
  type Embedder,
  type Reranker,
  RetrievalError,
  type RetrievalErrorCode,
  type SearchHit,
  type SearchResult,
  type SectionInput,
} from "./types.ts";
