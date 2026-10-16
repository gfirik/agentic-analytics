// One web search, end to end: sanitize the query → ask the provider → fetch the top results through the safe
// fetcher → readable text. Every page is external and untrusted: the caller sends it to the quarantined
// extractor and labels everything from it External. A page that fails a check is skipped and reported, not fatal.
import { type FetchedPage, type SafeFetchOptions, safeFetch } from "./fetch.ts";
import { htmlToText } from "./html.ts";
import { type PrivateTerms, type Sanitized, sanitizeQuery } from "./sanitize.ts";
import { type SearchProvider, WebError } from "./types.ts";

export interface WebPage {
  readonly url: string;
  readonly title: string;
  readonly fetched_at: string;
  readonly text: string;
  /** Text a reader doesn't see (hidden elements, comments): screened for injections, never extracted. */
  readonly hidden: string;
}

export interface WebSearchResult {
  /** The query as it was actually sent (sanitized). */
  readonly query: string;
  readonly removed: Sanitized["removed"];
  readonly pages: WebPage[];
  /** Results not fetched, with the reason (blocked address, private value in URL, too large, …). */
  readonly skipped: { url: string; code: string; message: string }[];
}

export interface WebSearchDeps {
  readonly provider: SearchProvider;
  readonly terms: PrivateTerms;
  /** Fetch one result URL (default: `safeFetch` with the private values). */
  readonly fetchPage?: (url: string) => Promise<FetchedPage>;
  readonly fetchOptions?: SafeFetchOptions;
  readonly maxPages?: number;
  /** Characters kept per page for extraction. */
  readonly maxChars?: number;
}

export async function webSearch(query: string, deps: WebSearchDeps): Promise<WebSearchResult> {
  const s = sanitizeQuery(query, deps.terms);
  // Fewer than two words left: nothing public to search for.
  if (s.query.split(" ").filter((w) => /\p{L}{2,}/u.test(w)).length < 2)
    return { query: s.query, removed: s.removed, pages: [], skipped: [] };
  const results = await deps.provider.search(s.query);
  const privateValues = [...deps.terms.names, ...(deps.terms.values ?? [])];
  const fetchPage = deps.fetchPage ?? ((url: string) => safeFetch(url, { ...deps.fetchOptions, privateValues }));
  const pages: WebPage[] = [];
  const skipped: WebSearchResult["skipped"] = [];
  for (const r of results) {
    if (pages.length >= (deps.maxPages ?? 3)) break;
    try {
      const page = await fetchPage(r.url);
      const { title, text, hidden } = /html|xml/i.test(page.contentType)
        ? htmlToText(page.body)
        : { title: "", text: page.body, hidden: "" };
      if (!text.trim()) continue;
      pages.push({
        url: page.url,
        title: title || r.title,
        fetched_at: page.fetched_at,
        text: text.slice(0, deps.maxChars ?? 20_000),
        hidden,
      });
    } catch (err) {
      if (!(err instanceof WebError)) throw err;
      skipped.push({ url: r.url, code: err.code, message: err.message });
    }
  }
  return { query: s.query, removed: s.removed, pages, skipped };
}
