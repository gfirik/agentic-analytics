// SQL of the RAG lane (AGENTS.md §4: parameterized templates only). Lists travel as JSON text cast to arrays.
import { fragment, type Sql, sql } from "@agentic-analytics/store";

export type Stemmer = "english" | "russian" | "none";

export const sectionsQuery = sql`
  SELECT s.id AS source_id, f.name AS file, s.kind, s.page, s.section AS heading_path, s.char_start, s.char_end, s.text,
    s.meta::VARCHAR AS meta
  FROM sources s JOIN files f ON f.id = s.file_id
  WHERE s.kind IN ('document', 'email') AND s.text IS NOT NULL
  ORDER BY f.name, s.page NULLS FIRST, s.char_start, s.id`;

export const clearChunks = [sql`DELETE FROM chunks`, sql`DELETE FROM retrieval_meta`];

export function insertChunk(c: {
  id: string;
  source_id: string;
  page: number | null;
  char_start: number;
  char_end: number;
  heading_path: readonly string[];
  prefix: string;
  text: string;
  embedding: readonly number[];
}): Sql {
  return sql`INSERT INTO chunks (id, source_id, page, char_start, char_end, heading_path, prefix, text, embedding)
    VALUES (${c.id}, ${c.source_id}, ${c.page}, ${c.char_start}, ${c.char_end}, ${JSON.stringify(c.heading_path)}::VARCHAR[],
      ${c.prefix}, ${c.text}, ${JSON.stringify(c.embedding)}::FLOAT[])`;
}

export function insertMeta(m: { embedder: string; dims: number; stemmer: Stemmer; fts: boolean; chunks: number }): Sql {
  return sql`INSERT INTO retrieval_meta VALUES (${m.embedder}, ${m.dims}, ${m.stemmer}, ${m.fts}, ${m.chunks})`;
}

export const readMeta = sql`SELECT embedder, dims, stemmer, fts, chunks FROM retrieval_meta LIMIT 1`;

export const loadFts = [sql`INSTALL fts`, sql`LOAD fts`];

/** BM25 over the prefix and the text; the stemmer is a fixed keyword, never user input. */
export const createFts: Record<Stemmer, Sql> = {
  english: sql`PRAGMA create_fts_index('chunks', 'id', 'prefix', 'text', stemmer = 'english', overwrite = 1)`,
  russian: sql`PRAGMA create_fts_index('chunks', 'id', 'prefix', 'text', stemmer = 'russian', overwrite = 1)`,
  none: sql`PRAGMA create_fts_index('chunks', 'id', 'prefix', 'text', stemmer = 'none', overwrite = 1)`,
};

export interface Filters {
  /** File names or source ids to search in. */
  readonly sources?: readonly string[];
  /** Inclusive ISO dates; only chunks with a known date (emails) can match a date filter. */
  readonly from?: string;
  readonly to?: string;
}

/**
 * The caller's filters, plus quarantine (security §3): a source the screen or the extractor flagged is never returned,
 * whenever it was flagged. Excluding it here, not at INDEX_DOCS, also covers a source the extractor flags mid-job, and
 * a flagged chunk no longer takes a top-k slot from real evidence before the extractor drops it.
 */
function filterSql(f: Filters): Sql {
  const src = f.sources?.length ? JSON.stringify(f.sources) : null;
  return sql`
    c.source_id NOT IN (SELECT source_id FROM quarantine)
    AND (${src}::VARCHAR[] IS NULL OR list_contains(${src}::VARCHAR[], c.source_id) OR list_contains(${src}::VARCHAR[], f.name))
    AND (${f.from ?? null}::VARCHAR IS NULL OR try_cast(left(s.meta->>'date', 10) AS DATE) >= ${f.from ?? null}::DATE)
    AND (${f.to ?? null}::VARCHAR IS NULL OR try_cast(left(s.meta->>'date', 10) AS DATE) <= ${f.to ?? null}::DATE)`;
}

export function bm25Top(query: string, f: Filters, limit: number): Sql {
  return sql`
    SELECT c.id FROM (SELECT *, fts_main_chunks.match_bm25(id, ${query}) AS score FROM chunks) c
    JOIN sources s ON s.id = c.source_id JOIN files f ON f.id = s.file_id
    WHERE c.score IS NOT NULL AND ${fragment(filterSql(f))}
    ORDER BY c.score DESC, c.id LIMIT ${limit}`;
}

/** Exact cosine search over every chunk (spec §2: job-sized corpora, no approximate index). */
export function vectorTop(embedding: readonly number[], f: Filters, limit: number): Sql {
  return sql`
    SELECT c.id FROM chunks c JOIN sources s ON s.id = c.source_id JOIN files f ON f.id = s.file_id
    WHERE ${fragment(filterSql(f))}
    ORDER BY list_cosine_similarity(c.embedding, ${JSON.stringify(embedding)}::FLOAT[]) DESC, c.id LIMIT ${limit}`;
}

/** Chunks by id, unfiltered: callers pass ids that already came through `filterSql` (bm25Top / vectorTop). */
export function chunksById(ids: readonly string[]): Sql {
  return sql`
    SELECT c.id, c.source_id, f.name AS file, c.page, c.heading_path, c.char_start, c.char_end, c.text, c.prefix
    FROM chunks c JOIN sources s ON s.id = c.source_id JOIN files f ON f.id = s.file_id
    WHERE list_contains(${JSON.stringify(ids)}::VARCHAR[], c.id)`;
}
