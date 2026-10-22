// The deterministic parser for numbers in prose (docs/specs/accuracy.md §8.4). Arms A and B answer in words; their
// numbers are read with fixed rules, never by a model. Dates and periods, ordinals and rank sizes ("top 10") are
// found and left out (dates are masked before reading) or marked excluded; so are numbers echoed from the question (`proseNumbers(text, question)`).

export type Exclusion = "date" | "ordinal" | "rank" | "echo";

export interface ProseNumber {
  readonly value: number;
  readonly raw: string;
  readonly index: number;
  /** Written with an explicit sign ("-7,900", "−7,900", "+3%"). */
  readonly signed: boolean;
  readonly percent: boolean;
  /** Why the number is not a claim about the data, when it isn't one. */
  readonly excluded?: Exclusion;
}

const MONTH = `(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;

// A day of the month (1–31), not the start of an amount: "March 44,300" is March and 44,300, not 44 March.
const DAY = String.raw`(?:3[01]|[12]\d|0?[1-9])(?:st|nd|rd|th)?\b(?![,.]\d)`;
const NOT_AMOUNT = String.raw`\b(?![,.]\d)`;

// Spans that are dates or periods, matched first so their digits are never read as amounts.
const DATE_SPANS = [
  /\b\d{4}-\d{2}(?:-\d{2})?\b/g, // 2026-04, 2026-04-12
  /\b\d{4}-W\d{1,2}\b/gi, // 2026-W12
  /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g, // 12/04/2026, 12.04.26
  /\bQ[1-4](?:\s*(?:of\s+)?\d{4})?\b/gi, // Q2, Q2 2026
  /\b\d{4}\s*Q[1-4]\b/gi, // 2026 Q2
  new RegExp(String.raw`\b${DAY}\s+${MONTH}\b\.?(?:,?\s+\d{4}${NOT_AMOUNT})?`, "gi"), // 12 April 2026
  new RegExp(String.raw`\b${MONTH}\b\.?\s+${DAY}(?:,?\s+\d{4}${NOT_AMOUNT})?`, "gi"), // April 12, 2026
  new RegExp(String.raw`\b${MONTH}\b\.?,?\s+\d{4}${NOT_AMOUNT}`, "gi"), // April 2026
  /\b(?:FY|fiscal(?:\s+year)?\s*)\d{2,4}\b/gi,
];

// A number: optional sign, optional currency, digits with thousands separators, decimals, a scale word, a percent.
const NUMBER =
  /(?<![\w.])([-−+])?\s?([$€£¥])?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:\s?(k|K|M|mn|bn|thousand|million|billion)(?![A-Za-z]))?(\s?%|\s?percent\b)?/g;

const SCALE: Record<string, number> = { k: 1e3, K: 1e3, thousand: 1e3, M: 1e6, mn: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };

/** "top 10", "bottom 3", "the 5 largest": a rank size, not an amount. */
const RANK_BEFORE = /\b(?:top|bottom|first|last|best|worst|largest|biggest|smallest|leading)\s*-?\s*$/i;
const RANK_AFTER = /^\s*(?:largest|biggest|smallest|highest|lowest|top|best|worst|leading)\b/i;
const ORDINAL_AFTER = /^(?:st|nd|rd|th)\b/i;

/**
 * Every number in `text`, in order. With `question`, a number whose value also appears in the question (outside its
 * dates) is marked `echo`. A bare four-digit whole number from 1900 to 2100 is a year (`date`).
 */
export function proseNumbers(text: string, question?: string): ProseNumber[] {
  const masked = maskDates(text);
  const echoes =
    question === undefined
      ? new Set<number>()
      : new Set(
          proseNumbers(question)
            .filter((n) => !n.excluded)
            .map((n) => n.value),
        );
  const out: ProseNumber[] = [];
  for (const m of masked.text.matchAll(NUMBER)) {
    const [raw, sign, currency, digits, scale, pct] = m;
    const index = m.index ?? 0;
    const base = Number((digits as string).replaceAll(",", ""));
    if (!Number.isFinite(base)) continue;
    let value = base * (scale ? (SCALE[scale] ?? 1) : 1);
    if (sign === "-" || sign === "−") value = -value;
    const before = masked.text.slice(Math.max(0, index - 12), index);
    const after = masked.text.slice(index + raw.length);
    let excluded: Exclusion | undefined;
    if (ORDINAL_AFTER.test(after)) excluded = "ordinal";
    else if (!currency && !pct && !scale && (RANK_BEFORE.test(before) || RANK_AFTER.test(after)) && Number.isInteger(base) && base <= 100)
      excluded = "rank";
    else if (!currency && !pct && !scale && !sign && /^\d{4}$/.test(digits as string) && base >= 1900 && base <= 2100) excluded = "date";
    else if (echoes.has(value) || echoes.has(Math.abs(value))) excluded = "echo";
    out.push({
      value,
      raw: raw.trim(),
      index,
      signed: sign !== undefined,
      percent: pct !== undefined,
      ...(excluded ? { excluded } : {}),
    });
  }
  return out;
}

/** The numbers that are claims about the data: everything not excluded. */
export const claimedNumbers = (text: string, question?: string): ProseNumber[] =>
  proseNumbers(text, question).filter((n) => n.excluded === undefined);

/** Replaces date and period spans with spaces of the same length, keeping every other index in place. */
function maskDates(text: string): { text: string } {
  let t = text;
  for (const re of DATE_SPANS) t = t.replace(re, (raw: string) => " ".repeat(raw.length));
  return { text: t };
}

/**
 * The values a prose number may stand for when compared with a figure: itself; for an unsigned number, also its
 * negative (prose states a fall as "fell by 7,900"); for a percent, also the fraction (12.5% ↔ 0.125). This is the
 * lenient reading, which favours arms A and B.
 */
export function readings(n: Pick<ProseNumber, "value" | "signed" | "percent">): number[] {
  const out = [n.value];
  if (!n.signed) out.push(-n.value);
  if (n.percent) out.push(...out.map((v) => v / 100));
  return out;
}
