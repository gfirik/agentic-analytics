// Implausibility rules (ingestion spec §5): each finding becomes a quality issue with cell provenance.
import type { NormalizedTable, Workspace } from "@agentic-analytics/store";
import { tableName } from "@agentic-analytics/store";
import { COUNT_NAME, ID_HEADER } from "./normalize.ts";
import {
  aboveHundredRows,
  aboveOneRows,
  fallingCumulativeRows,
  farFromMedian,
  futureDateRows,
  futurePeriodPartsRows,
  idPrefixes,
  negativeRows,
  nullRows,
  periodPartsCoverage,
  powerOfTenJumps,
  refundMarkerCount,
} from "./profile.sql.ts";
import type { TableRoles } from "./roles/detect.ts";
import type { TableKind } from "./roles/kinds.ts";
import type { TableProfile } from "./stats.ts";

export type RuleIssueKind =
  | "unit_error"
  | "negative_quantity"
  | "negative_amount"
  | "non_monotone_cumulative"
  | "rate_above_100"
  | "future_date"
  | "missing_id"
  | "missing_value"
  | "prefixed_id";

export interface RuleIssue {
  readonly kind: RuleIssueKind;
  readonly severity: "high" | "medium" | "low";
  readonly message: string;
  readonly table_id: string;
  readonly column: string;
  readonly letter: string;
  /** The first row the issue is about. */
  readonly row: number;
  /** Column-level issues: the first rows (up to 20); the full count is in `details`. */
  readonly rows?: readonly number[];
  readonly details: Record<string, unknown>;
}

/** Column-level issues list at most this many rows; `details` carries the full count. */
const MAX_ROWS = 20;

const RATE_NAME = /\b(rate|ratio|share|percent|pct)\b|%|доля|ставка|процент|ulush|foiz/i;
/**
 * A header that marks a running total (ingestion spec §5, cumulative columns), also in Russian. Short words count only
 * as their own token: `\b` treats `_` as a letter, so "revenue_ytd" and "cum_sales" need the explicit lookarounds.
 */
const CUMULATIVE_NAME =
  /cumulative|(?<![a-z])(?:cum|ytd)(?![a-z])|year[ _-]to[ _-]date|(?<![a-z])to[ _-]date|accumulated|нарастающ|с начала года|нарастан/i;
/** A column or a category value that says the table keeps refunds or returns as negative sales (also in Russian and Uzbek). */
// Kept as a string: the same pattern goes to DuckDB (RE2), and a bundler may rewrite non-ASCII letters inside a regex
// literal as `\u` escapes, which RE2 rejects ("invalid escape sequence"); a string's value keeps the letters.
const REFUND_PATTERN = "refund|return|credit|cancel|chargeback|возврат|отмен|qaytar";
const REFUND_WORD = new RegExp(REFUND_PATTERN, "i");
const AMOUNT_TYPES = new Set(["integer", "decimal", "currency"]);
const FACTOR = { 1: "10", 2: "100", 3: "1,000" } as const;

export interface RuleOptions {
  /** The detected column roles: they tell which column is the sales amount and which year/month columns are the period. */
  readonly roles?: TableRoles;
  /** The table's period column: a future date there is left out of the analysis, which the issue records. */
  readonly dateColumn?: string;
  /** The table's kind: a negative amount is checked only in sales lines and period summaries (a ledger is signed by design). */
  readonly kind?: TableKind;
}

/** Table kinds whose amount column holds sales, so a negative value is out of the ordinary. */
const SALES_KINDS: ReadonlySet<TableKind> = new Set(["sales_lines", "period_summary"]);

export async function runRules(
  ws: Workspace,
  t: NormalizedTable,
  profile: TableProfile,
  today: string,
  options: RuleOptions = {},
): Promise<RuleIssue[]> {
  const { roles, dateColumn, kind } = options;
  const name = tableName(t.id);
  const issues: RuleIssue[] = [];

  for (const c of t.columns) {
    const p = profile.columns.find((x) => x.name === c.name);
    const base = { table_id: t.id, column: c.name, letter: c.letter };

    // Sudden ×10/×100/×1000 jumps suggest a unit or decimal error. A column with many values far from its
    // median is multi-modal (e.g. wholesale orders among retail ones): that is real data, so the rule only
    // runs when at most two values (or 0.5% of rows) sit half a decade or more away from the median.
    const isolated = Math.max(2, 0.005 * profile.detail_rows);
    const median = p?.median;
    if (AMOUNT_TYPES.has(c.type) && median && median > 0 && (p?.non_null ?? 0) >= 4) {
      const far = (await ws.one<{ n: number }>(farFromMedian(name, c.name, median)))?.n ?? 0;
      const hits =
        far <= isolated ? await ws.all<{ _row: number; value: number; k: 1 | 2 | 3 }>(powerOfTenJumps(name, c.name, median)) : [];
      const byK = new Map<number, typeof hits>();
      for (const h of hits) {
        const same = byK.get(h.k);
        if (same) same.push(h);
        else byK.set(h.k, [h]);
      }
      for (const [k, rows] of byK) {
        if (rows.length > isolated) continue;
        for (const h of rows) {
          issues.push({
            ...base,
            kind: "unit_error",
            severity: "high",
            message: `"${c.label}" row ${h._row} is about ${FACTOR[h.k]}× the column median; likely a unit or decimal-point error`,
            row: h._row,
            details: { value: h.value, median, factor: 10 ** k },
          });
        }
      }
    }
    if (AMOUNT_TYPES.has(c.type) && COUNT_NAME.test(c.label)) {
      for (const r of await ws.all<{ _row: number }>(negativeRows(name, c.name))) {
        issues.push({
          ...base,
          kind: "negative_quantity",
          severity: "medium",
          message: `"${c.label}" is negative at row ${r._row}`,
          row: r._row,
          details: {},
        });
      }
    }
    // A negative sales amount is a refund, a credit or an entry error. Refunds are legitimately negative, so the rule
    // stays quiet when the table itself says it keeps them: a status or type value, or a column, named refund/return.
    // A column already reported as a negative quantity is not reported again.
    const isAmount = roles?.columns.some((r) => r.column === c.name && r.role === "amount") ?? false;
    const quantityFlagged = issues.some((i) => i.kind === "negative_quantity" && i.column === c.name);
    if (
      isAmount &&
      kind &&
      SALES_KINDS.has(kind) &&
      AMOUNT_TYPES.has(c.type) &&
      !quantityFlagged &&
      !(await keepsRefunds(ws, t, name, c.name))
    ) {
      const rows = (await ws.all<{ _row: number }>(negativeRows(name, c.name))).map((r) => r._row);
      if (rows.length)
        issues.push({
          ...base,
          kind: "negative_amount",
          severity: "medium",
          message: `"${c.label}" is negative in ${rows.length} rows, and the table has no refund or return marker`,
          row: rows[0] as number,
          rows: rows.slice(0, MAX_ROWS),
          details: { count: rows.length },
        });
    }
    // A running total never falls within its year, except by a revision or a negative month; it is flagged, not repaired.
    if (AMOUNT_TYPES.has(c.type) && CUMULATIVE_NAME.test(c.label) && dateColumn && dateColumn !== c.name) {
      // The members of a series: every column that names one (category, id, text, flag), unless it is nearly unique,
      // which would make every row its own series.
      const members = new Set(["category", "id", "text", "boolean"]);
      const dims = t.columns
        .filter((x) => {
          const px = profile.columns.find((y) => y.name === x.name);
          return members.has(x.type) && x.name !== dateColumn && (px?.distinct_count ?? 0) * 2 <= profile.detail_rows;
        })
        .map((x) => x.name);
      const rows = (await ws.all<{ _row: number }>(fallingCumulativeRows(name, c.name, dateColumn, dims))).map((r) => r._row);
      if (rows.length)
        issues.push({
          ...base,
          kind: "non_monotone_cumulative",
          severity: "medium",
          message: `"${c.label}" falls from the previous period within a year in ${rows.length} rows; a cumulative series should not fall`,
          row: rows[0] as number,
          rows: rows.slice(0, MAX_ROWS),
          details: { count: rows.length },
        });
    }
    // Percent columns hold fractions (above 1 = above 100%); rate-named plain numbers hold points (above 100).
    const rateNamed = (c.type === "decimal" || c.type === "integer") && RATE_NAME.test(c.label);
    if (c.type === "percent" || rateNamed) {
      for (const r of await ws.all<{ _row: number }>(c.type === "percent" ? aboveOneRows(name, c.name) : aboveHundredRows(name, c.name))) {
        issues.push({
          ...base,
          kind: "rate_above_100",
          severity: "medium",
          message: `"${c.label}" is above 100% at row ${r._row}`,
          row: r._row,
          details: {},
        });
      }
    }
    if (c.type === "date" || c.type === "datetime") {
      for (const r of await ws.all<{ _row: number }>(futureDateRows(name, c.name, today))) {
        issues.push({
          ...base,
          kind: "future_date",
          severity: "medium",
          message: `"${c.label}" is after ${today} at row ${r._row}`,
          row: r._row,
          details: { today, left_out: c.name === dateColumn, all_future: c.name === dateColumn && profile.date_first === undefined },
        });
      }
    }
    // An identifier column (customer, invoice, order) that is empty in some rows: those rows can't be linked to
    // anyone, so per-customer analysis silently drops them. Mostly-empty columns are optional fields, not gaps.
    const nonNull = p?.non_null ?? 0;
    const missing = profile.detail_rows - nonNull;
    if (ID_HEADER.test(c.label) && missing > 0 && nonNull >= missing) {
      const rows = (await ws.all<{ _row: number }>(nullRows(name, c.name))).map((r) => r._row);
      issues.push({
        ...base,
        kind: "missing_id",
        severity: "medium",
        message: `"${c.label}" is empty in ${missing} of ${profile.detail_rows} rows`,
        row: rows[0] ?? 0,
        rows: rows.slice(0, MAX_ROWS),
        details: { missing, rows_total: profile.detail_rows },
      });
    }
    // A number column (an amount, a value) that is empty in some rows: sums skip those rows, so totals for the
    // periods they fall in are understated or missing (e.g. values suppressed for confidentiality).
    if ((AMOUNT_TYPES.has(c.type) || c.type === "percent") && !ID_HEADER.test(c.label) && missing > 0 && nonNull >= missing) {
      const rows = (await ws.all<{ _row: number }>(nullRows(name, c.name))).map((r) => r._row);
      issues.push({
        ...base,
        kind: "missing_value",
        severity: "low",
        message: `"${c.label}" is empty in ${missing} of ${profile.detail_rows} rows`,
        row: rows[0] ?? 0,
        rows: rows.slice(0, MAX_ROWS),
        details: { missing, rows_total: profile.detail_rows },
      });
    }
    // Document numbers where most are plain digits and some carry a letter prefix ("C489434" among "489434"): the
    // prefix marks a different kind of document, often a cancellation or credit note, that sums and counts mix in.
    if (c.type === "id") {
      const shapes = await ws.all<{ prefix: string; n: number; rows: number[] }>(idPrefixes(name, c.name));
      const plain = Number(shapes.find((s) => s.prefix === "")?.n ?? 0);
      for (const s of shapes) {
        if (s.prefix === "" || plain < nonNull / 2 || Number(s.n) >= plain) continue;
        const rows = [...s.rows].map(Number);
        issues.push({
          ...base,
          kind: "prefixed_id",
          severity: "medium",
          message: `${s.n} values of "${c.label}" start with "${s.prefix}" while ${plain} are plain numbers; prefixed document numbers often mark cancellations or credit notes`,
          row: rows[0] ?? 0,
          rows,
          details: { prefix: s.prefix, count: Number(s.n), plain },
        });
      }
    }
  }
  // A table dated by a year and a month column: months after today's month are left out of its coverage too.
  const parts = roles?.period_parts;
  if (parts && !dateColumn) {
    const rows = (await ws.all<{ _row: number }>(futurePeriodPartsRows(name, parts.year, parts.month, today))).map((r) => r._row);
    const col = t.columns.find((c) => c.name === parts.year);
    if (rows.length && col) {
      const cov = await ws.one<{ first: string | null }>(periodPartsCoverage(name, parts.year, parts.month, today));
      issues.push({
        table_id: t.id,
        column: col.name,
        letter: col.letter,
        kind: "future_date",
        severity: "medium",
        message: `"${col.label}" holds months after ${today} in ${rows.length} rows`,
        row: rows[0] as number,
        rows: rows.slice(0, MAX_ROWS),
        details: { today, left_out: true, all_future: cov?.first == null, count: rows.length },
      });
    }
  }
  return issues;
}

/**
 * Whether the table keeps refunds or returns as marked rows, so a negative amount in it is expected: another column
 * whose header names them, or text in a category or text column that does (counted over every row, not a sample).
 */
async function keepsRefunds(ws: Workspace, t: NormalizedTable, name: string, amount: string): Promise<boolean> {
  for (const c of t.columns) {
    if (c.name === amount) continue;
    if (REFUND_WORD.test(c.label)) return true;
    if (c.type !== "category" && c.type !== "text") continue;
    if (Number((await ws.one<{ n: number }>(refundMarkerCount(name, c.name, REFUND_PATTERN)))?.n ?? 0) > 0) return true;
  }
  return false;
}
