# Spec: retrieval (`packages/retrieval`): the RAG lane

Retrieval covers documents, emails and fetched web pages only. Tables are never retrieved as text: numbers come from SQL.

## 1. Chunking

- Chunk along structure: headings, then paragraphs, then sentences. Target 300–600 tokens with 15% overlap. Never split a table across chunks; a table over 600 tokens becomes its own chunk.
- Each chunk stores `source_id`, `page`, `char_start` and `char_end`, the heading path, and a cleaned `text`.
- Each chunk also gets a contextual prefix: `[file · section path · date if known]`, prepended for embedding and BM25 only. Citations still point at the raw span.
- Emails are chunked per message, with sender, recipient and date in the prefix.

## 2. Indexes (in the job's DuckDB file)

- **Full text:** DuckDB `fts` extension, BM25 over `chunks.text` with prefix and stemming (English and Russian; Uzbek uses no stemmer).
- **Vectors:** `chunks.embedding FLOAT[1024]` from an in-process ONNX embedding model via `@huggingface/transformers` (default `Xenova/bge-m3`; a smaller multilingual model is allowed if bge-m3 is too slow on CPU; Ollama embeddings are optional). The embedding dimension follows the chosen model. Search with exact `array_cosine_similarity`. Job-sized corpora (under 50k chunks) make exact search fast and fully accurate. Don't use the experimental VSS index.

## 3. Query flow

1. The agent issues a query plus optional filters (source, date range) through the `search_documents` tool.
2. BM25 top 50 and vector top 50 are fused with Reciprocal Rank Fusion (k = 60).
3. The top 30 fused results are reranked with `bge-reranker-v2-m3` (ONNX via `@huggingface/transformers`, CPU), keeping the top 8. If the reranker isn't available, keep the fused order and set `degraded: rerank`.
4. Results go to the **quarantined extractor**, never straight to the planner (see specs/security.md).

## 4. Citations

- A citation quote is an exact substring of the source span, at most 300 characters.
- The verifier checks two things:
  - that the quote string exists in the source at that span;
  - that it entails the claim (see agent-and-verifier.md §7).

## 5. Quality measurement

The eval set includes retrieval questions with labelled relevant chunks. Track:

- recall@8;
- MRR;
- the "answer-bearing chunk in context" rate.

These are reported per embedding and reranker setting. Targets for v0.1: recall@8 ≥ 0.85 on the synthetic corpus.
