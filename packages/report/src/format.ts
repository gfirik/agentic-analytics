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
      // Sums of cents come back from SQL as e.g. 44100.00000000001: whole to the cent reads as whole.
      return `${sign(value)}${grouped(value, Math.abs(value - Math.round(value)) < 0.005 ? 0 : 2)}`;
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

/**
 * Functions whose result, on percentages, is a difference of percentages: percentage points, not a percent change.
 * ("Refunds went from 1.2% to 3.4%": a change of 2.2 pp; "−17.9%" stays a percent change from `pct_change`.)
 */
const POINTS = new Set(["delta", "benchmark_gap.v1", "share_shift"]);

export function formatFact(f: Fact): string {
  if (f.unit === "percent" && f.computation.kind === "function" && POINTS.has(f.computation.fn ?? ""))
    return `${sign(f.value)}${grouped(f.value, 1)} pp`;
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
  // "rate" as its own word (Refund rate, refund_rate, refundRate), never inside one ("Corporate client", "Separate fee").
  if ((/(?:^|[^a-z])rates?(?:$|[^a-z])|%/i.test(header) || /[a-z]Rates?\b/.test(header)) && Math.abs(v) < 1)
    return `${sign(v)}${grouped(v * 100, 1)}%`;
  return `${sign(v)}${grouped(v, Number.isInteger(v) ? 0 : 2)}`;
}
