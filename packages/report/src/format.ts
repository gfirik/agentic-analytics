// Display formatting for facts. Formatting is presentation only: it rounds for reading, it never derives
// a new number (AGENTS.md §2.1). The exact value stays in the fact and in the computation panel.
import type { Fact, RecommendationsNote } from "@agentic-analytics/schema";

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

/**
 * A money value names its unit after the number: "40,896,000 USD", "17,776,691.7 million UZS". The scale is the one the
 * file's header states; the value is as in the file, never multiplied (report-schema §3). "XXX" (currency unknown) is not shown.
 */
export function moneySuffix(f: Pick<Fact, "currency" | "scale">): string {
  return `${f.scale ? ` ${f.scale}` : ""}${f.currency && f.currency !== "XXX" ? ` ${f.currency}` : ""}`;
}

/** A metric series value for `aa metrics`: money reads like a fact (grouped, with its scale and currency); other units stay as computed. */
export function formatMetricValue(
  value: number,
  def: { readonly unit: Fact["unit"]; readonly currency?: string | undefined; readonly scale?: Fact["scale"] | undefined },
): string {
  return def.unit === "currency" ? `${formatValue(value, "currency")}${moneySuffix(def)}` : String(Number(value.toFixed(4)));
}

export function formatFact(f: Fact): string {
  if (f.unit === "percent" && f.computation.kind === "function" && POINTS.has(f.computation.fn ?? ""))
    return `${sign(f.value)}${grouped(f.value, 1)} pp`;
  return f.unit === "currency" ? `${formatValue(f.value, f.unit)}${moneySuffix(f)}` : formatValue(f.value, f.unit);
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-01".."2026-06" → "Jan–Jun 2026"; "0000".."9999" (no dates found) → "no period"; other bounds are shown as given. */
export function formatPeriod(from: string, to: string): string {
  // A job that found no dates keeps the placeholder bounds 0000 and 9999 (report-schema §1): there is no period to show.
  if (from === "0000" && to === "9999") return "no period";
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

const RECOMMENDATIONS_NOTE_TEXT: Record<RecommendationsNote, string> = {
  step_failed:
    "No recommendation could be produced: the step that drafts actions did not return a valid result. The findings above still stand.",
  none_passed: "Recommendations were drafted but none passed the checks. The findings above still stand.",
};

/** The line shown where recommendations would be when there are none (report-schema §1); undefined when no note applies. */
export function recommendationsNote(r: { readonly recommendations_note?: RecommendationsNote | undefined }): string | undefined {
  return r.recommendations_note ? RECOMMENDATIONS_NOTE_TEXT[r.recommendations_note] : undefined;
}

/** Row numbers as a short label: consecutive rows become a range, gaps join ranges with commas, and past two ranges the rest is "+N more". */
export function rowLabel(rows: readonly number[]): string {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  for (const r of sorted) {
    const last = ranges.at(-1);
    if (last && r === last[1] + 1) last[1] = r;
    else ranges.push([r, r]);
  }
  const text = ([a, b]: [number, number]) => (a === b ? `r${a}` : `r${a}\u2013r${b}`);
  const shown = ranges.slice(0, 2).map(text).join(", ");
  const rest = ranges.slice(2).reduce((n, [a, b]) => n + b - a + 1, 0);
  return rest ? `${shown} +${rest} more` : shown;
}

/** The "Exact value" line of the number panel: the stored value without binary float noise (44100.000000000065 reads 44100), never grouped or rounded further. */
export function formatExact(f: Pick<Fact, "value" | "unit" | "currency" | "scale">): string {
  return `${Number(f.value.toPrecision(14))}${moneySuffix(f)}${f.unit === "percent" ? " %" : ""}`;
}

/** The panel's Metric line. The description already ends in "(assumed)" for an assumed metric, so the marker is added only when it is missing. */
export function metricLine(m: { readonly label: string; readonly plain: string; readonly status?: string | undefined }): string {
  const marker = " (assumed)";
  return `${m.label}: ${m.plain}${m.status === "assumed" && !m.plain.endsWith(marker) ? marker : ""}`;
}
