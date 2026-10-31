# @agentic-analytics/web

The web lane: search providers (SearXNG first), the query sanitizer, the safe fetcher and readable-text extraction.
- **Off by default.** It runs only for jobs with `--web`.
- **Sanitized queries.** Every query is sanitized before it leaves the machine.
- **External content.** Every page is external, untrusted text for the quarantined extractor.

- **Spec:** docs/specs/security.md §4; docs/specs/agent-and-verifier.md §4
- **Status:** built in M8.

## Public API

- `sanitizeQuery(query, { names, values })` returns `{ query, removed }`.
  - It strips private names (with or without their legal form), private values, emails, phones, URLs and every number except years.
  - `leaksPrivate(text, terms)` is the guard used in tests.
- `safeFetch(url, options)` enforces:
  - http(s) only, on ports 80 and 443;
  - no credentials, and no private value in the query string;
  - every resolved address checked at connect time (`isBlockedAddress`: private, loopback, link-local, CGNAT, reserved, multicast, IPv6 and mapped forms);
  - manual redirects, re-checked each time, at most 3;
  - a 10 s timeout, a 3 MB cap, and text types only.
  - `checkUrl` runs the URL checks alone. A private value is matched in the query the way the sanitizer matches it (every spelling `phrases` gives, on the normalised text, whole words, plus joined spellings).
  - The body is decoded in the page's own charset (`decodeBody`: the Content-Type header's, else `<meta charset>`, else UTF-8).
- `htmlToText(html)` returns `{ title, text, hidden }`: `text` is the visible text only (scripts, navigation and hidden elements dropped); `hidden` is the text of hidden elements, of the page chrome left out of `text` (nav, header, footer, aside, form, button, select) and of HTML comments, kept only so the injection screen can read it. There is no colour check: white-on-white text stays in `text`. It runs in linear time on any input (a hostile page can't stall the event loop).
- `searxngProvider({ baseUrl })` is a `SearchProvider` over SearXNG's JSON API. `docker compose --profile web up -d searxng` starts one with JSON enabled (`docker/searxng/settings.yml`).
- `webSearch(query, { provider, terms, fetchPage? })` runs sanitize → search → fetch the top pages → readable text. It returns `{ query (as sent), removed, pages, skipped }`; each `WebPage` carries `text` and `hidden` (never the raw HTML).
- Typed errors: `WebError` with codes `BAD_URL`, `BLOCKED_ADDRESS`, `PRIVATE_VALUE`, `TOO_LARGE`, `TIMEOUT`, `TOO_MANY_REDIRECTS`, `HTTP_STATUS`, `NOT_TEXT`, `FETCH_FAILED` and `PROVIDER`.

## Example

```bash
docker compose --profile web up -d searxng
bun run --filter @agentic-analytics/web web:search -- "Hotel Group LLC 8500 specialty coffee wholesale prices 2026" --private "Hotel Group LLC"
# query as sent:  specialty coffee wholesale prices 2026
```

In a job, the agent's `search_web` and `compare_benchmark` tools use this lane (`packages/agent/src/web.ts`): pages become external sources `W1…`, extracts are marked `external`, and quoted ranges become `external_quote` facts for `benchmark_gap.v1`.
