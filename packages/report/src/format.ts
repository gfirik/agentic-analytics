// Display formatting for facts. Formatting is presentation only: it rounds for reading, it never derives
// a new number (AGENTS.md §2.1). The exact value stays in the fact and in the computation panel.
import type { Fact } from "@agentic-analytics/schema";

const MINUS = "−";
const grouped = (v: number, digits: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(v));
const sign = (v: number) => (v < 0 ? MINUS : "");

export function formatValue(value: number, unit: Fact["unit"]): string {
  switch (unit) {
    case "currency":
      return `${sign(value)}${grouped(value, Number.isInteger(value) ? 0 : 2)}`;
    case "percent":
      // ≥ 100% reads better without decimals ("108%"); smaller shares keep one ("−17.9%").
      return `${sign(value)}${grouped(value, Math.abs(value) >= 100 ? 0 : 1)}%`;
    case "count":
      return `${sign(value)}${grouped(value, 0)}`;
    case "days":
      return `${sign(value)}${grouped(value, 0)} days`;
    case "ratio":
      return `${sign(value)}${grouped(value, Math.abs(value) >= 100 ? 0 : 2)}`;
    default:
      return `${sign(value)}${grouped(value, Number.isInteger(value) ? 0 : 2)}`;
  }
}

export function formatFact(f: Fact): string {
  return formatValue(f.value, f.unit);
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-01".."2026-06" → "Jan–Jun 2026"; other bounds are shown as given. */
export function formatPeriod(from: string, to: string): string {
  const a = /^(\d{4})-(\d{2})$/.exec(from);
  const b = /^(\d{4})-(\d{2})$/.exec(to);
  if (a && b) {
    const ma = MONTH_NAMES[Number(a[2]) - 1];
    const mb = MONTH_NAMES[Number(b[2]) - 1];
    return a[1] === b[1] ? `${ma}–${mb} ${b[1]}` : `${ma} ${a[1]} – ${mb} ${b[1]}`;
  }
  return `${from} – ${to}`;
}

/** Spreadsheet cell values for the evidence viewer, shown as the owner typed them. */
export function formatCell(v: string | number | null, header: string): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (/rate|%/i.test(header) && Math.abs(v) < 1) return `${grouped(v * 100, 1)}%`;
  return `${sign(v)}${grouped(v, Number.isInteger(v) ? 0 : 2)}`;
}
