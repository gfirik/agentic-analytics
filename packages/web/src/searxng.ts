// SearXNG, the default search provider (self-hosted, no key, no tracking). The provider is a configured service
// (often on localhost), so it is called directly, not through the safe fetcher; the safe fetcher is for the
// result URLs, which come from the internet. Queries reach it only after sanitizing (see `webSearch`).
import { type SearchProvider, type SearchResult, WebError } from "./types.ts";

export interface SearxngOptions {
  /** e.g. http://localhost:8888 (docker compose --profile web up -d searxng) */
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly maxResults?: number;
  readonly timeoutMs?: number;
  /** Comma-separated SearXNG engines to use (default: the instance's own); some engines rate-limit or CAPTCHA. */
  readonly engines?: string;
}

export function searxngProvider(options: SearxngOptions): SearchProvider {
  const doFetch = options.fetch ?? globalThis.fetch;
  const max = options.maxResults ?? 8;
  return {
    id: `searxng:${options.baseUrl}`,
    async search(query) {
      const url = new URL("search", options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("safesearch", "1");
      if (options.engines) url.searchParams.set("engines", options.engines);
      let res: Response;
      try {
        res = await doFetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 10_000), headers: { accept: "application/json" } });
      } catch (err) {
        throw new WebError(
          "PROVIDER",
          `SearXNG at ${options.baseUrl} is not reachable: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!res.ok)
        throw new WebError(
          "PROVIDER",
          `SearXNG answered HTTP ${res.status}${res.status === 403 ? " (enable the json format in settings.yml)" : ""}`,
        );
      const body = (await res.json()) as { results?: { url?: unknown; title?: unknown; content?: unknown }[] };
      const out: SearchResult[] = [];
      for (const r of body.results ?? []) {
        if (typeof r.url !== "string" || !/^https?:\/\//i.test(r.url)) continue;
        out.push({
          url: r.url,
          title: typeof r.title === "string" ? r.title : "",
          snippet: typeof r.content === "string" ? r.content : "",
        });
        if (out.length >= max) break;
      }
      return out;
    },
  };
}
