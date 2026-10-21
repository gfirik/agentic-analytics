// The agent's side of the web lane (agent-and-verifier §4, security §4): what counts as private in this job,
// and how fetched pages become external sources and quarantined extracts.
import { chunkSpans, type SearchHit } from "@agentic-analytics/retrieval";
import { screen } from "@agentic-analytics/schema";
import { ident, sql, tableName, type Workspace } from "@agentic-analytics/store";
import { type FetchedPage, type PrivateTerms, type SearchProvider, type WebSearchResult, webSearch } from "@agentic-analytics/web";
import { quarantine } from "./extractor.ts";

export interface WebLane {
  readonly provider: SearchProvider;
  /** Fetch one result URL (default: the safe fetcher with the job's private values). */
  readonly fetchPage?: (url: string) => Promise<FetchedPage>;
  readonly terms: PrivateTerms;
}

/** Columns whose values name people or organisations (EN/RU/UZ labels). */
const PERSONAL =
  /customer|client|supplier|vendor|buyer|account|contact|name|person|manager|employee|staff|email|phone|company|organi[sz]ation|\borg\b|partner|firm|brand|store|shop|клиент|покупател|поставщик|контрагент|менеджер|сотрудник|имя|компани|фирм|организаци|партнер|магазин|mijoz|xaridor|yetkazib|ism|korxona|tashkilot|hamkor|do'kon/i;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;

/**
 * Everything in this job that must never leave the machine through a search query or a URL: matched entities and
 * their raw spellings, every value of columns that name people or organisations, the names and addresses in email
 * headers, the actors the extractor found, file names, and email addresses found in documents. Numbers are removed from queries by the sanitizer regardless.
 */
export async function privateTerms(ws: Workspace): Promise<PrivateTerms> {
  const names = new Set<string>();
  for (const r of await ws.all<{ v: string }>(sql`SELECT canonical_name AS v FROM entities UNION SELECT raw_value AS v FROM entity_links`))
    if (r.v?.trim()) names.add(r.v.trim());
  const cols = await ws.all<{ table_id: string; name: string; label: string; type: string }>(
    sql`SELECT table_id, name, label, type FROM table_columns ORDER BY table_id, position`,
  );
  for (const c of cols) {
    if (!["category", "text", "id"].includes(c.type) || !PERSONAL.test(`${c.name} ${c.label}`)) continue;
    const rows = await ws.all<{ v: string | null }>(
      sql`SELECT DISTINCT CAST(${ident(c.name)} AS VARCHAR) AS v FROM ${ident(tableName(c.table_id))} WHERE ${ident(c.name)} IS NOT NULL`,
    );
    for (const r of rows) if (r.v?.trim()) names.add(r.v.trim());
  }
  // People and organisations named outside the tables: an email's sender and recipients ("Name <address>", from its
  // headers) and the actors the extractor found in documents. A name that appears only there is still private.
  for (const r of await ws.all<{ v: string | null }>(
    sql`SELECT meta->>'from' AS v FROM sources WHERE kind = 'email' UNION ALL SELECT meta->>'to' AS v FROM sources WHERE kind = 'email'`,
  ))
    for (const part of (r.v ?? "").split(",")) {
      const name = part
        .replace(/<[^>]*>/g, "")
        .replace(/["']/g, "")
        .trim();
      if (name && !name.includes("@")) names.add(name); // a bare address is a value, below
    }
  for (const r of await ws.all<{ v: string | null }>(sql`SELECT payload->>'actor' AS v FROM extracts`))
    if (r.v?.trim()) names.add(r.v.trim());
  const values = new Set<string>();
  for (const r of await ws.all<{ name: string }>(sql`SELECT name FROM files`)) values.add(r.name);
  // Addresses in email headers too, not only in the text.
  for (const r of await ws.all<{ v: string | null }>(
    sql`SELECT coalesce(meta->>'from', '') || ',' || coalesce(meta->>'to', '') AS v FROM sources WHERE kind = 'email'`,
  ))
    for (const m of (r.v ?? "").match(EMAIL) ?? []) values.add(m);
  for (const r of await ws.all<{ text: string }>(sql`SELECT text FROM sources WHERE text IS NOT NULL AND kind <> 'web'`))
    for (const m of r.text.match(EMAIL) ?? []) values.add(m);
  return { names: [...names], values: [...values] };
}

async function nextWebNumber(ws: Workspace): Promise<number> {
  const r = await ws.one<{ n: number | null }>(sql`SELECT max(CAST(substr(id, 2) AS INTEGER)) AS n FROM sources WHERE kind = 'web'`);
  return (r?.n ?? 0) + 1;
}

/**
 * Runs one web search and stores each fetched page as an external source (`W1`, …) with its URL, title and fetch
 * time. Returns the result plus excerpts of each page (the first few chunks) as hits for the quarantined extractor.
 */
export async function searchAndStore(ws: Workspace, lane: WebLane, query: string): Promise<{ result: WebSearchResult; hits: SearchHit[] }> {
  // Recomputed per search: the extractor adds actors during the stage, after the lane's terms were taken.
  const now = await privateTerms(ws);
  const terms: PrivateTerms = {
    names: [...new Set([...lane.terms.names, ...now.names])],
    values: [...new Set([...(lane.terms.values ?? []), ...(now.values ?? [])])],
  };
  const result = await webSearch(query, {
    provider: lane.provider,
    terms,
    ...(lane.fetchPage ? { fetchPage: lane.fetchPage } : {}),
  });
  const hits: SearchHit[] = [];
  let n = await nextWebNumber(ws);
  for (const page of result.pages) {
    const id = `W${n++}`;
    await ws.run(
      sql`INSERT INTO sources (id, file_id, kind, external, char_start, char_end, text, meta)
          VALUES (${id}, 'WEB', 'web', true, 0, ${page.text.length}, ${page.text},
            ${JSON.stringify({ url: page.url, title: page.title, fetched_at: page.fetched_at })}::JSON)`,
    );
    await ws.run(
      sql`INSERT INTO web_results (id, url, title, fetched_at, extract_ids, external)
          VALUES (${id}, ${page.url}, ${page.title}, ${page.fetched_at}::TIMESTAMPTZ AT TIME ZONE 'UTC', []::VARCHAR[], true)`,
    );
    // Hidden text is dropped from what we keep, but a page that hides instructions is not to be trusted at all.
    if (screen(page.text) || screen(page.hidden)) {
      await quarantine(ws, id, "the page addresses a model (possibly in hidden text)", "screen");
      continue;
    }
    // A few excerpts per page bound the extractor's work; benchmark statements sit near the top of most pages.
    for (const [i, span] of chunkSpans(page.text, { maxTokens: 300 }).slice(0, 3).entries())
      hits.push({
        untrusted: true,
        chunk_id: `${id}:${i + 1}`,
        source_id: id,
        file: page.url,
        heading_path: [],
        char_start: span.start,
        char_end: span.end,
        text: page.text.slice(span.start, span.end),
        prefix: "",
        score: 0,
      });
  }
  return { result, hits };
}
