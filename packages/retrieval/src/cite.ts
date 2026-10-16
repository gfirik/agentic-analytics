// Citation quotes (retrieval spec §4): a quote is an exact substring of the cited span, at most 300 characters,
// with its offsets in the same coordinate space as the chunk (page text for PDFs, document text otherwise).
import type { Chunk } from "./types.ts";
import { RetrievalError } from "./types.ts";

export const MAX_QUOTE = 300;

export interface Quote {
  readonly source_id: string;
  readonly page?: number;
  readonly char_start: number;
  readonly char_end: number;
  readonly quote: string;
}

/**
 * The quote for absolute offsets [start, end) inside a chunk. Longer spans are cut at the last word boundary
 * that fits, so the quote never ends mid-word; it is still an exact substring of the source.
 */
export function quoteFor(chunk: Pick<Chunk, "source_id" | "page" | "char_start" | "char_end" | "text">, start: number, end: number): Quote {
  if (!(start >= chunk.char_start && end <= chunk.char_end && end > start))
    throw new RetrievalError("BAD_SPAN", `span ${start}–${end} is outside chunk ${chunk.char_start}–${chunk.char_end}`);
  let s = chunk.text.slice(start - chunk.char_start, end - chunk.char_start);
  if (s.length > MAX_QUOTE) {
    const cut = s.lastIndexOf(" ", MAX_QUOTE);
    s = s.slice(0, cut > MAX_QUOTE / 2 ? cut : MAX_QUOTE);
  }
  return {
    source_id: chunk.source_id,
    ...(chunk.page !== undefined ? { page: chunk.page } : {}),
    char_start: start,
    char_end: start + s.length,
    quote: s,
  };
}

/** The quote for the first occurrence of `text` in a chunk, or undefined when the chunk doesn't contain it. */
export function findQuote(chunk: Pick<Chunk, "source_id" | "page" | "char_start" | "char_end" | "text">, text: string): Quote | undefined {
  const i = chunk.text.indexOf(text);
  return i < 0 ? undefined : quoteFor(chunk, chunk.char_start + i, chunk.char_start + i + text.length);
}
