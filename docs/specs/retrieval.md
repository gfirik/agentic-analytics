# Spec: retrieval (`packages/retrieval`): the RAG lane

Retrieval covers documents, emails and fetched web pages only. Tables are never retrieved as text: numbers come from SQL.

## 1. Chunking

- Chunk along structure: headings, then paragraphs, then sentences. Target 300–600 tokens with 15% overlap. Never split a table across chunks; a table over 600 tokens becomes its own chunk.
- Each chunk stores `source_id`, `page`, `char_start` and `char_end`, the heading path, and a cleaned `text`.
- Each chunk also gets a contextual prefix: `[file · section path · date if known]`, prepended for embedding and BM25 only. Citations still point at the raw span.
- Emails are chunked per message, with sender, recipient and date in the prefix.
- Ingest already cuts documents at headings, so a section is the first unit. A section within the budget is one chunk, and sections are never merged: merging would blur citations to separate passages. Tokens are estimated as words × 1.3, independent of the embedding model's tokenizer. Chunk `text` is the exact source slice (no cleaning), so citation offsets stay exact. Whitespace does not affect BM25 or the embeddings.

## 2. Indexes (in the job's DuckDB file)

- **Full text:** DuckDB `fts` extension, BM25 over `chunks.text` with prefix and stemming (English and Russian; Uzbek uses no stemmer).
- **Stemmer:** one FTS index has one stemmer, so it follows the corpus: Russian when most letters are Cyrillic, otherwise English. Callers pass `none` for Uzbek. If the `fts` extension cannot be loaded (offline first run), search runs vector-only and reports `degraded: bm25`.
- **Vectors:** `chunks.embedding FLOAT[]` (a list: the dimension follows the model; searched with `list_cosine_similarity`) from an in-process ONNX embedding model via `@huggingface/transformers` (default `Xenova/bge-m3`; a smaller multilingual model is allowed if bge-m3 is too slow on CPU; Ollama embeddings are optional). Search is exact (no approximate index): job-sized corpora (under 50k chunks) make exact search fast and fully accurate. Don't use the experimental VSS index. The `retrieval_meta` table records the embedder that built the index; a query with a different embedder is refused. Without a model download, the deterministic `hashEmbedder` (hashed words and character 3–5-grams) is the fallback; tests use it.

## 3. Query flow

1. The agent issues a query plus optional filters (source, date range) through the `search_documents` tool.
2. BM25 top 50 and vector top 50 are fused with Reciprocal Rank Fusion (k = 60).
3. The top 30 fused results are reranked with `bge-reranker-v2-m3` (ONNX via `@huggingface/transformers`, CPU; default `onnx-community/bge-reranker-v2-m3-ONNX`), keeping the top 8. If the reranker isn't available, keep the fused order and set `degraded: rerank`.
4. Results go to the **quarantined extractor**, never straight to the planner (see specs/security.md). A source in the `quarantine` table is never returned: the search filter excludes it at query time.

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

These are reported per embedding and reranker setting. Targets for v0.1: recall@8 ≥ 0.85 on the synthetic corpus. The labelled questions live in `evals/retrieval/questions.yaml` (coffee-roaster-v1 and printing-shop-v1, the latter with near-miss distractors and Russian documents). `eval:retrieval` reports each setting, and the unit tests assert the target with the offline embedder.
