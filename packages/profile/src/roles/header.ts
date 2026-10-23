// Header normalization for the name signal (docs/specs/semantics.md §2.1): lower-cased, punctuation and case-joins
// split (`UnitPrice` → `unit price`), apostrophes dropped, ё read as е. Synonyms go through the same function, so
// a header and a synonym agree however each is spelled.

export function headerTokens(label: string): string[] {
  return label
    .normalize("NFKC")
    .replace(/['’ʼ‘`]/g, "")
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Tokens without a trailing run of plain numbers (`series_title_2` → series title): an index isn't part of the name. */
export function stemTokens(tokens: readonly string[]): string[] {
  let end = tokens.length;
  while (end > 1 && /^\d+$/.test(tokens[end - 1] ?? "")) end--;
  return tokens.slice(0, end);
}
