// Date parsing (ingestion spec §6): ISO, dd.mm.yyyy, dd/mm/yyyy, mm/dd/yyyy, Excel serials, and month names
// in English, Russian and Uzbek. dd/mm vs mm/dd is decided per column by a majority test.

export type DateOrder = "dmy" | "mdy";

export interface ParsedDate {
  /** "2026-03-15" or "2026-03-15 09:30:00". */
  readonly iso: string;
  readonly hasTime: boolean;
}

const MONTHS: readonly (readonly string[])[] = [
  ["jan", "january", "янв", "январь", "января", "yanvar", "yan"],
  ["feb", "february", "фев", "февр", "февраль", "февраля", "fevral", "fev"],
  ["mar", "march", "мар", "март", "марта", "mart"],
  ["apr", "april", "апр", "апрель", "апреля", "aprel"],
  ["may", "май", "мая"],
  ["jun", "june", "июн", "июнь", "июня", "iyun"],
  ["jul", "july", "июл", "июль", "июля", "iyul"],
  ["aug", "august", "авг", "август", "августа", "avgust", "avg"],
  ["sep", "sept", "september", "сен", "сент", "сентябрь", "сентября", "sentyabr", "sen"],
  ["oct", "october", "окт", "октябрь", "октября", "oktyabr", "okt"],
  ["nov", "november", "ноя", "нояб", "ноябрь", "ноября", "noyabr", "noy"],
  ["dec", "december", "дек", "декабрь", "декабря", "dekabr", "dek"],
];

/** 1–12 for a month name in EN/RU/UZ (full, genitive or abbreviated), else undefined. */
export function monthNumber(word: string): number | undefined {
  const w = word.toLowerCase().replace(/[.,]$/, "");
  const i = MONTHS.findIndex((forms) => forms.includes(w));
  return i >= 0 ? i + 1 : undefined;
}

const pad = (n: number) => String(n).padStart(2, "0");

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function build(y: number, m: number, d: number, time?: readonly (string | undefined)[]): ParsedDate | undefined {
  if (!valid(y, m, d)) return undefined;
  const date = `${y}-${pad(m)}-${pad(d)}`;
  if (time?.[0] === undefined) return { iso: date, hasTime: false };
  // "24:00" or "12:75" isn't a time DuckDB accepts, so the cell is not a date rather than a failed load.
  if (Number(time[0]) > 23 || Number(time[1] ?? 0) > 59 || Number(time[2] ?? 0) > 59) return undefined;
  return { iso: `${date} ${pad(Number(time[0]))}:${time[1] ?? "00"}:${time[2] ?? "00"}`, hasTime: true };
}

/** A two-digit year, read as POSIX `%y` does: 69–99 are 1969–1999, 00–68 are 2000–2068 ("98" is 1998, not 2098). */
const century = (yy: number) => (yy >= 69 ? 1900 + yy : 2000 + yy);

const NUMERIC = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const ISO = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const YEAR_MONTH = /^(\d{4})-(\d{2})$/;

/**
 * Which day/month order a numeric date allows: "dmy", "mdy", "ambiguous" (both ≤ 12 and different), "either"
 * (equal parts, e.g. 03/03: same date both ways, no evidence) or undefined (not a numeric date).
 */
export function dateOrderEvidence(raw: string): DateOrder | "ambiguous" | "either" | undefined {
  const m = NUMERIC.exec(raw.trim());
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a > 12 && b <= 12) return "dmy";
  if (b > 12 && a <= 12) return "mdy";
  if (a <= 12 && b <= 12) return a === b ? "either" : "ambiguous";
  return undefined;
}

export interface DateOrderDecision {
  readonly order: DateOrder;
  /** Values that could be read either way. */
  readonly ambiguous: number;
  readonly dmy: number;
  readonly mdy: number;
  /** No value decided the order, so `order` is the day-first default and needs an assumption. */
  readonly assumed: boolean;
  /** Both orders have evidence: the column mixes formats. */
  readonly conflict: boolean;
}

/** Per-column majority test (spec §6): any value above 12 in either position decides the order. */
export function detectDateOrder(samples: readonly string[]): DateOrderDecision {
  let dmy = 0;
  let mdy = 0;
  let ambiguous = 0;
  for (const s of samples) {
    const e = dateOrderEvidence(s);
    if (e === "dmy") dmy++;
    else if (e === "mdy") mdy++;
    else if (e === "ambiguous") ambiguous++;
  }
  return {
    order: mdy > dmy ? "mdy" : "dmy",
    ambiguous,
    dmy,
    mdy,
    assumed: dmy === 0 && mdy === 0 && ambiguous > 0,
    conflict: dmy > 0 && mdy > 0,
  };
}

export function parseDate(raw: string, order: DateOrder = "dmy"): ParsedDate | undefined {
  const s = raw.trim();
  let m = ISO.exec(s);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]), [m[4], m[5], m[6]]);
  m = YEAR_MONTH.exec(s);
  if (m) return build(Number(m[1]), Number(m[2]), 1);
  m = NUMERIC.exec(s);
  if (m) {
    const y = m[3]?.length === 2 ? century(Number(m[3])) : Number(m[3]);
    const [d, mo] = order === "dmy" ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])];
    return build(y, mo, d, [m[4], m[5], m[6]]);
  }
  // Month names: "Jan 2026", "January 2026", "15 March 2026", "March 15, 2026", "15 марта 2026 г.", "yanvar 2026".
  const words = s
    .replace(/\s+г\.?$/i, "")
    .split(/[\s,]+/)
    .filter(Boolean);
  if (words.length >= 2 && words.length <= 3) {
    const year = Number(words[words.length - 1]);
    if (!/^\d{4}$/.test(words[words.length - 1] ?? "")) return undefined;
    if (words.length === 2) {
      const mo = monthNumber(words[0] ?? "");
      return mo ? build(year, mo, 1) : undefined;
    }
    const [x, y] = [words[0] ?? "", words[1] ?? ""];
    const mo1 = monthNumber(y);
    if (mo1 && /^\d{1,2}$/.test(x)) return build(year, mo1, Number(x));
    const mo2 = monthNumber(x);
    if (mo2 && /^\d{1,2}$/.test(y)) return build(year, mo2, Number(y));
  }
  return undefined;
}

/** Excel serial date (1900 system) → ISO date; only for plausible business dates (1954–2119). */
export function serialToDate(serial: number): ParsedDate | undefined {
  if (!Number.isFinite(serial) || serial < 20_000 || serial > 80_000) return undefined;
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000);
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const frac = serial % 1;
  return frac
    ? { iso: `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`, hasTime: true }
    : { iso: date, hasTime: false };
}
