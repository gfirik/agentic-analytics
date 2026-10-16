// Public API of @agentic-analytics/web: the web lane (agent-and-verifier §4, security §4).
export { checkUrl, type FetchedPage, type Lookup, type SafeFetchOptions, safeFetch } from "./fetch.ts";
export { decodeEntities, htmlToText } from "./html.ts";
export { isBlockedAddress, parseIPv4, parseIPv6 } from "./ip.ts";
export { type WebPage, type WebSearchDeps, type WebSearchResult, webSearch } from "./lane.ts";
export { leaksPrivate, type PrivateTerms, type Sanitized, sanitizeQuery } from "./sanitize.ts";
export { type SearxngOptions, searxngProvider } from "./searxng.ts";
export { type SearchProvider, type SearchResult, WebError, type WebErrorCode } from "./types.ts";
