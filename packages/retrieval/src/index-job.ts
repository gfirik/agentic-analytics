// Indexing (retrieval spec §2): document and email sections of a job → chunks with embeddings in the job's
// DuckDB file, plus a BM25 index. Rebuilt in full each time: the FTS index is static, and job corpora are small.
import type { Workspace } from "@agentic-analytics/store";
import { type ChunkOptions, chunkSections } from "./chunk.ts";
import { clearChunks, createFts, insertChunk, insertMeta, loadFts, type Stemmer, sectionsQuery } from "./retrieval.sql.ts";
import type { Chunk, Embedder, SectionInput } from "./types.ts";

export interface IndexOptions extends ChunkOptions {
  /** BM25 stemmer; default: chosen from the corpus script (see `chooseStemmer`). */
  readonly stemmer?: Stemmer;
  /** Texts per embedding call. */
  readonly batchSize?: number;
}

export interface IndexSummary {
  readonly chunks: number;
  readonly embedder: string;
  readonly dims: number;
  readonly stemmer: Stemmer;
  /** False when the DuckDB fts extension could not be loaded: search then runs vector-only (degraded: bm25). */
  readonly fts: boolean;
  /** Why the BM25 index could not be built, when `fts` is false. */
  readonly ftsError?: string;
}

/**
 * One FTS index has one stemmer, so it follows the corpus: Russian when most letters are Cyrillic, else English.
 * Uzbek (Latin or Cyrillic) has no Snowball stemmer; callers that know the corpus is Uzbek pass "none".
 */
export function chooseStemmer(texts: readonly string[]): Stemmer {
  let cyr = 0;
  let lat = 0;
  for (const t of texts) {
    cyr += (t.match(/\p{Script=Cyrillic}/gu) ?? []).length;
    lat += (t.match(/\p{Script=Latin}/gu) ?? []).length;
  }
  return cyr > lat ? "russian" : "english";
}

export async function readSections(ws: Workspace): Promise<SectionInput[]> {
  const rows = await ws.all<{
    source_id: string;
    file: string;
    kind: "document" | "email";
    page: number | null;
    heading_path: string[] | null;
    char_start: number;
    char_end: number;
    text: string;
    meta: string | null;
  }>(sectionsQuery);
  return rows.map((r) => {
    const meta = r.meta ? (JSON.parse(r.meta) as SectionInput["email"]) : undefined;
    return {
      source_id: r.source_id,
      file: r.file,
      kind: r.kind,
      ...(r.page !== null ? { page: r.page } : {}),
      heading_path: r.heading_path ?? [],
      char_start: r.char_start,
      char_end: r.char_end,
      text: r.text,
      ...(meta ? { email: meta } : {}),
    };
  });
}

export async function indexDocuments(ws: Workspace, embedder: Embedder, options: IndexOptions = {}): Promise<IndexSummary> {
  const sections = await readSections(ws);
  const chunks: Chunk[] = chunkSections(sections, options);
  const batch = options.batchSize ?? 32;
  const vectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += batch) {
    // The prefix is embedded with the text (contextual retrieval); citations still point at the raw span.
    vectors.push(
      ...(await embedder.embed(
        chunks.slice(i, i + batch).map((c) => `${c.prefix}\n${c.text}`),
        "passage",
      )),
    );
  }
  for (const q of clearChunks) await ws.run(q);
  for (const [i, c] of chunks.entries()) {
    await ws.run(
      insertChunk({
        id: c.id,
        source_id: c.source_id,
        page: c.page ?? null,
        char_start: c.char_start,
        char_end: c.char_end,
        heading_path: c.heading_path,
        prefix: c.prefix,
        text: c.text,
        embedding: vectors[i] ?? [],
      }),
    );
  }
  const stemmer = options.stemmer ?? chooseStemmer(chunks.map((c) => c.text));
  let fts = false;
  let ftsError: string | undefined;
  if (chunks.length) {
    try {
      for (const q of loadFts) await ws.run(q);
      await ws.run(createFts[stemmer]);
      fts = true;
    } catch (err) {
      // No fts extension (offline first run): vector search alone still works, search reports degraded: bm25,
      // and the reason is returned to the caller.
      ftsError = err instanceof Error ? err.message : String(err);
    }
  }
  const dims = vectors[0]?.length ?? 0;
  await ws.run(insertMeta({ embedder: embedder.id, dims, stemmer, fts, chunks: chunks.length }));
  return { chunks: chunks.length, embedder: embedder.id, dims, stemmer, fts, ...(ftsError ? { ftsError } : {}) };
}
