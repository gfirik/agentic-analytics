// Shared types of the web lane.

export type WebErrorCode =
  | "BAD_URL"
  | "BLOCKED_ADDRESS"
  | "PRIVATE_VALUE"
  | "TOO_LARGE"
  | "TIMEOUT"
  | "TOO_MANY_REDIRECTS"
  | "HTTP_STATUS"
  | "NOT_TEXT"
  | "FETCH_FAILED"
  | "PROVIDER";

export class WebError extends Error {
  constructor(
    readonly code: WebErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WebError";
  }
}

export interface SearchResult {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
}

export interface SearchProvider {
  readonly id: string;
  search(query: string): Promise<SearchResult[]>;
}
