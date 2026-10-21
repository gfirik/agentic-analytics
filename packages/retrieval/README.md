# @agentic-analytics/retrieval

The RAG lane for documents and emails (never tables: their numbers come from SQL): structure-aware chunking, in-process ONNX embeddings, DuckDB BM25 and exact vector search, RRF fusion, optional cross-encoder rerank, and exact citation quotes.

- **Spec:** docs/specs/retrieval.md
- **Status:** built in M6.

## Public API

- `indexDocuments(ws, embedder, options?)`: chunks the job's document and email sections (`sources` table), embeds `prefix + text`, writes `chunks` and builds the BM25 index. Returns `{ chunks, embedder, dims, stemmer, fts }`.
- `searchDocuments(ws, query, { embedder, reranker?, k?, sources?, from?, to? })`: BM25 top 50 + vector top 50 → RRF (k = 60) → top 30 reranked → top 8. Returns `{ hits, degraded, reasons }`. A quarantined source (the `quarantine` table) is never returned, by either path (security §3). `degraded` contains `"rerank"` when no reranker is given or it fails (including `RERANK_FAILED`: wrong score count or non-finite scores), and `"bm25"` when the DuckDB fts extension is unavailable. `reasons` keeps the message for each. Every hit carries `untrusted: true`: its text goes to the quarantined extractor only.
- Embedders:
  - `transformersEmbedder({ model?, dtype?, cacheDir? })`: default `Xenova/bge-m3` (q8).
  - `hashEmbedder(dims?)`: deterministic feature hashing, no download. Used by tests and as the offline fallback.
- `transformersReranker({ model?, dtype?, cacheDir? })`: default `onnx-community/bge-reranker-v2-m3-ONNX`.
- Chunking: `chunkSections`, `chunkSpans`, `prefixOf`, `estimateTokens`.
- Citations: `quoteFor(chunk, start, end)`, `findQuote(chunk, text)`. A quote is an exact substring, at most 300 characters.
- Quality: `quality(judged, k?)` computes recall@k, MRR and answer-in-context. `rrf(rankings, k?)` is exported too.

## Example

```ts
import { hashEmbedder, indexDocuments, searchDocuments, transformersEmbedder } from "@agentic-analytics/retrieval";

const embedder = transformersEmbedder(); // or hashEmbedder() offline
await indexDocuments(ws, embedder);
const { hits, degraded } = await searchDocuments(ws, "Why did BrightAds leave?", { embedder });
// hits[0]: { file: "email-brightads.eml", char_start, char_end, text, prefix, score, … }; degraded: ["rerank"]
```

## Eval

```bash
bun run --filter @agentic-analytics/retrieval eval:retrieval                                  # hash embedder, no rerank
bun run --filter @agentic-analytics/retrieval eval:retrieval -- --embedder Xenova/bge-m3 \
  --reranker onnx-community/bge-reranker-v2-m3-ONNX                                          # downloads ~1 GB once
```

Models are cached in `$AA_MODELS_DIR`, or `~/.cache/agentic-analytics/models` when it is unset.
