// Locale-aware number parsing (ingestion spec §6): "1 234,56", "1,234.56", "1.234,56", "(12)", "12%",
// with currency symbols or codes. The decimal separator is decided per column, by majority evidence.

export type DecimalSeparator = "." | ",";

export interface ParsedNumber {
  readonly value: number;
  readonly percent: boolean;
  readonly currency?: string;
}

/** Currency symbols and codes → ISO 4217 (spec §6: `$`, `€`, `£`, `сум`, `UZS`, `so'm`, `₽`, …). */
const CURRENCY_TOKENS: readonly [RegExp, string][] = [
  [/US\$|\$/, "USD"],
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/₽|руб\.?/i, "RUB"],
  [/сум|сўм|so['’‘`ʻ]?m\b/i, "UZS"],
  [/\b(USD|EUR|GBP|RUB|UZS|KZT|CNY|TRY)\b/i, ""],
];

export function detectCurrency(raw: string): string | undefined {
  for (const [re, code] of CURRENCY_TOKENS) {
    const m = re.exec(raw);
    if (m) return code || m[0].toUpperCase();
  }
  return undefined;
}

/**
 * Evidence for the decimal separator in one value. With both separators present the last one is the decimal
 * ("1.234,56", "1,234.56"); a repeated separator is a thousands separator ("1.234.567"); a single separator
 * followed by exactly three digits ("1,234") is ambiguous and gives no evidence.
 */
export function decimalEvidence(raw: string): DecimalSeparator | undefined {
  const s = raw.replace(/[^\d.,]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) return lastComma > lastDot ? "," : ".";
  const sep = lastComma >= 0 ? "," : lastDot >= 0 ? "." : undefined;
  if (!sep) return undefined;
  const parts = s.split(sep);
  if (parts.length > 2) return sep === "," ? "." : ",";
  return (parts[1] ?? "").length === 3 ? undefined : sep;
}

/** The column's decimal separator: majority of evidence, "." when there is none. */
export function detectDecimal(samples: readonly string[]): DecimalSeparator {
  let comma = 0;
  let dot = 0;
  for (const s of samples) {
    const e = decimalEvidence(s);
    if (e === ",") comma++;
    else if (e === ".") dot++;
  }
  return comma > dot ? "," : ".";
}

export function parseNumber(raw: string, decimal: DecimalSeparator = "."): ParsedNumber | undefined {
  let s = raw.trim();
  if (!s) return undefined;
  const currency = detectCurrency(s);
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  const percent = /%\s*$/.test(s);
  s = s
    .replace(/%\s*$/, "")
    .replace(/US\$|\$|€|£|₽|руб\.?|сум|сўм|so['’‘`ʻ]?m\b|\b(USD|EUR|GBP|RUB|UZS|KZT|CNY|TRY)\b/gi, "")
    .replace(/[\s  ']/g, "");
  if (/^[-−–]/.test(s)) {
    negative = !negative;
    s = s.slice(1);
  }
  if (decimal === ",") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return undefined;
  const n = Number(s) * (negative ? -1 : 1);
  return { value: percent ? n / 100 : n, percent, ...(currency ? { currency } : {}) };
}
