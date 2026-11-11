// The scale and currency a column header states in words: `value_thousand_uzs`, `Revenue (USD mn)`, `amount_mln`.
// Deterministic token matching (ingestion-and-profiling §6): a word counts only as its own token, so "kg",
// "monthly" and "bank" never read as a scale. The values stay as in the file; only the display names the unit.

export type Scale = "thousand" | "million" | "billion";

const SCALE_WORDS: Readonly<Record<string, Scale>> = {
  thousand: "thousand",
  thousands: "thousand",
  thous: "thousand",
  thsd: "thousand",
  "'000": "thousand",
  "’000": "thousand",
  k: "thousand",
  тыс: "thousand",
  ming: "thousand",
  million: "million",
  millions: "million",
  mln: "million",
  mn: "million",
  mio: "million",
  млн: "million",
  billion: "billion",
  billions: "billion",
  bln: "billion",
  bn: "billion",
  млрд: "billion",
  mlrd: "billion",
};

const CURRENCY_WORDS: ReadonlySet<string> = new Set(["usd", "eur", "gbp", "rub", "uzs", "kzt", "cny"]);

/** Whether a (normalized) header word only states a unit: a scale or a currency code. The role detector ignores these. */
export const isUnitWord = (word: string): boolean => Object.hasOwn(SCALE_WORDS, word) || CURRENCY_WORDS.has(word) || word === "000";

/**
 * Header → lower-case tokens, kept apart from the role detector's `headerTokens` (roles/header.ts), which drops
 * apostrophes: that is why `isUnitWord` also knows "000". Change the two together.
 * Splits on `_`, space, `-`, `(`, `)`, `,` and also `.`, `/`, `[`, `]`. */
export function unitWords(header: string): string[] {
  return header
    .toLowerCase()
    .split(/[\s_\-(),./[\]]+/)
    .filter(Boolean);
}

export interface HeaderUnits {
  readonly scale?: Scale;
  readonly currency?: string;
}

/** What one header says. Two different scales (or currencies) in one header are a conflict and say nothing. */
export function headerUnits(header: string): HeaderUnits {
  const words = unitWords(header);
  // A header that is only unit words ("MN" for Minnesota, a "K" column) names no amount, so it states no unit either.
  if (!words.some((w) => !isUnitWord(w))) return {};
  const scales = new Set<Scale>();
  const currencies = new Set<string>();
  for (const [i, t] of words.entries()) {
    const s = Object.hasOwn(SCALE_WORDS, t) ? SCALE_WORDS[t] : undefined;
    // "price_per_k" is a price per thousand units, not an amount in thousands.
    if (s && words[i - 1] !== "per") scales.add(s);
    if (CURRENCY_WORDS.has(t)) currencies.add(t.toUpperCase());
  }
  const [scale] = scales.size === 1 ? scales : [];
  const [currency] = currencies.size === 1 ? currencies : [];
  return { ...(scale ? { scale } : {}), ...(currency ? { currency } : {}) };
}
