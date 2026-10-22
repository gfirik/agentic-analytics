// Column type inference and normalization (docs/specs/ingestion-and-profiling.md §5–6): ingestion's raw
// cells become typed values (ISO dates, numbers, booleans, trimmed text) plus a `_period` at the job grain.
import type { Cell, TableRegion } from "@agentic-analytics/ingest";
import type { Grain } from "@agentic-analytics/schema";
import type { ColumnType, NormalizedColumn, NormalizedRow, NormalizedTable, NormalizedValue } from "@agentic-analytics/store";
import { type DateOrderDecision, dateOrderEvidence, detectDateOrder, parseDate, serialToDate } from "./dates.ts";
import { columnNames } from "./names.ts";
import { type DecimalSeparator, detectCurrency, detectDecimal, parseNumber } from "./numbers.ts";

export type { Grain };

export interface ColumnIssue {
  readonly kind: "date_format_ambiguity" | "date_format_conflict" | "mixed_currency" | "unparseable_value";
  readonly severity: "high" | "medium" | "low";
  readonly message: string;
  readonly column: string; // snake_case name
  readonly letter: string;
  /** Sheet rows the issue is about (capped). */
  readonly rows: readonly number[];
  readonly details?: Record<string, unknown>;
}

export interface NormalizeResult {
  readonly table: NormalizedTable;
  readonly issues: ColumnIssue[];
  /** Name of the column `_period` was derived from, if any. */
  readonly periodColumn?: string;
}

const MIN_SHARE = 0.9;
const DATE_HEADER = /date|month|period|day|time|дата|месяц|период|день|sana|oy\b|kun/i;
const MONEY_HEADER = /amount|revenue|sales|price|cost|sum\b|turnover|выручка|сумма|цена|стоимость|оборот|tushum|narx|summa/i;
export const ID_HEADER = /(^|[\s_/(])(id|code|sku|№|no\.?|number|номер|код|артикул|raqam)($|[\s_/)])/i;
const NOTE_HEADER = /note|comment|description|remark|memo|details|примечание|комментарий|описание|izoh/i;
const TRUE_WORDS = new Set(["true", "yes", "y", "да", "ha", "1"]);
const FALSE_WORDS = new Set(["false", "no", "n", "нет", "yo'q", "yoq", "0"]);

const isFilled = (c: Cell | undefined): c is Cell => c !== undefined && c.v !== null && !(typeof c.v === "string" && c.v.trim() === "");

interface Inferred {
  readonly type: ColumnType;
  readonly currency?: string;
  readonly decimal: DecimalSeparator;
  readonly dates?: DateOrderDecision;
  /** Numbers that encode a month as `year.month` (2002.10 is October 2002), as Stats NZ and Infoshare exports do. */
  readonly yearMonth?: boolean;
  readonly issues: Omit<ColumnIssue, "column" | "letter" | "rows">[];
}

/** A document number behind a short letter prefix: "C489434", "CN-1021". */
const PREFIXED_ID = /^[A-Za-z]{1,3}-?\d+$/;
/** Headers that name a count (quantity, units): a few "x2" cells in one are typos, not document numbers. */
export const COUNT_NAME = /qty|quantity|count|units|pcs|pieces|orders|кол|шт|количество|soni|dona/i;

/**
 * `year.month` as a number → the month's first day ("2002-10-01"), or undefined. The month is the two decimals:
 * 2002.1 is how "2002.10" reads once parsed as a number, so it is October; 2002.01 is January; 2002.13 and 2002.55
 * are not months, and years outside 1900–2100 are not periods.
 */
export function yearMonthOf(v: number): string | undefined {
  if (!Number.isFinite(v)) return undefined;
  const y = Math.floor(v);
  const hundredths = (v - y) * 100;
  const m = Math.round(hundredths);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || Math.abs(hundredths - m) > 1e-6) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** Decides a column's type from its detail (non-total) cells. */
export function inferColumn(label: string, cells: readonly (Cell | undefined)[]): Inferred {
  const filled = cells.filter(isFilled);
  const strings = filled.filter((c) => c.t === "s").map((c) => String(c.v).trim());
  const decimal = detectDecimal(strings);
  const share = (n: number) => (filled.length ? n / filled.length : 0);
  if (!filled.length) return { type: "text", decimal, issues: [] };

  // Dates: typed date cells, or text dates with a per-column day/month order.
  const dates = detectDateOrder(strings);
  const parsedDates = filled.filter((c) => c.t === "d" || (c.t === "s" && parseDate(String(c.v), dates.order)));
  if (share(parsedDates.length) >= MIN_SHARE) {
    const hasTime = filled.some((c) => /[T ]\d{1,2}:\d{2}/.test(String(c.v)));
    const issues: Inferred["issues"] = [];
    if (dates.conflict) {
      issues.push({
        kind: "date_format_conflict",
        severity: "medium",
        message: `column mixes day-first and month-first dates (${dates.dmy} vs ${dates.mdy} decisive values)`,
        details: { ...dates },
      });
    } else if (dates.ambiguous > 0) {
      issues.push({
        kind: "date_format_ambiguity",
        severity: dates.assumed ? "medium" : "low",
        message: dates.assumed
          ? `${dates.ambiguous} dates could be day-first or month-first and nothing decides it; read day-first (assumption)`
          : `${dates.ambiguous} dates could be day-first or month-first; read ${dates.order === "dmy" ? "day-first" : "month-first"} because ${dates.order === "dmy" ? dates.dmy : dates.mdy} values only fit that order`,
        details: { ...dates },
      });
    }
    return { type: hasTime ? "datetime" : "date", decimal, dates, issues };
  }

  // Booleans.
  const bools = filled.filter(
    (c) =>
      c.t === "b" ||
      (c.t === "s" && (TRUE_WORDS.has(String(c.v).trim().toLowerCase()) || FALSE_WORDS.has(String(c.v).trim().toLowerCase()))),
  );
  if (share(bools.length) >= MIN_SHARE && filled.some((c) => c.t === "b" || !/^[01]$/.test(String(c.v))))
    return { type: "boolean", decimal, issues: [] };

  // Numbers, percentages and money.
  const parsed = filled.map((c) =>
    c.t === "n"
      ? { value: c.v as number, percent: false, currency: undefined }
      : c.t === "s"
        ? parseNumber(String(c.v), decimal)
        : undefined,
  );
  const numeric = parsed.filter((p) => p !== undefined);
  if (share(numeric.length) >= MIN_SHARE) {
    const values = numeric.map((p) => p.value);
    // Excel serials in a date-named column.
    if (DATE_HEADER.test(label) && values.every((v) => Number.isInteger(v) && serialToDate(v)))
      return { type: "date", decimal, issues: [] };
    // `year.month` periods in a date-named column.
    if (DATE_HEADER.test(label) && values.every((v) => yearMonthOf(v) !== undefined))
      return { type: "date", decimal, yearMonth: true, issues: [] };
    // Whole numbers mixed with letter-prefixed numbers ("489434", "C489434") are identifiers: document numbers whose
    // prefix marks a kind of document (a cancellation, a credit note). Read as numbers, every prefixed cell would be
    // emptied as unparseable.
    const others = filled.flatMap((c, i) => (parsed[i] === undefined ? [String(c.v).trim()] : []));
    if (
      others.length &&
      others.length < values.length &&
      !COUNT_NAME.test(label) &&
      values.every((v) => Number.isInteger(v) && v >= 0) &&
      others.every((v) => PREFIXED_ID.test(v))
    )
      return { type: "id", decimal, issues: [] };
    const formatPercent = filled.some((c) => typeof c.z === "string" && c.z.includes("%"));
    if (formatPercent || numeric.some((p) => p.percent)) return { type: "percent", decimal, issues: [] };
    const currencies = new Set<string>();
    for (const p of numeric) if (p.currency) currencies.add(p.currency);
    for (const c of filled) {
      const code = typeof c.z === "string" ? detectCurrency(c.z.replace(/"[^"]*"/g, (m) => m.slice(1, -1))) : undefined;
      if (code) currencies.add(code);
    }
    if (currencies.size > 1) {
      return {
        type: "currency",
        decimal,
        issues: [
          {
            kind: "mixed_currency",
            severity: "high",
            message: `column mixes currencies (${[...currencies].sort().join(", ")}); each row's currency is kept in a companion _currency column and amounts are never converted or summed across currencies`,
            details: { currencies: [...currencies].sort() },
          },
        ],
      };
    }
    if (currencies.size === 1) return { type: "currency", currency: [...currencies][0] ?? "", decimal, issues: [] };
    // Multi-row headers read "Sales / Orders": the leaf names the quantity, so judge money by the leaf.
    if (MONEY_HEADER.test(label.split(" / ").at(-1) ?? label)) return { type: "currency", decimal, issues: [] };
    return { type: values.every((v) => Number.isInteger(v)) ? "integer" : "decimal", decimal, issues: [] };
  }

  // Text: identifiers, categories, free text.
  if (ID_HEADER.test(label)) return { type: "id", decimal, issues: [] };
  const distinct = new Set(filled.map((c) => String(c.v).trim().toLowerCase())).size;
  const avgLength = filled.reduce((s, c) => s + String(c.v).length, 0) / filled.length;
  // Short label-like values are categories; long or sentence-like values, or a notes-style header, are free text.
  // A loop, not Math.max(...cells): spreading a large column overflows the call stack.
  const maxWords = filled.reduce((m, c) => Math.max(m, String(c.v).trim().split(/\s+/).length), 0);
  if (!NOTE_HEADER.test(label) && avgLength <= 40 && maxWords <= 6 && (distinct <= 50 || distinct / filled.length <= 0.5)) {
    return { type: "category", decimal, issues: [] };
  }
  return { type: "text", decimal, issues: [] };
}

/** Normalizes one cell to the column's type; undefined means the cell doesn't fit the type. */
export function normalizeCell(cell: Cell | undefined, inferred: Inferred): NormalizedValue | undefined {
  if (!isFilled(cell)) return null;
  const raw = cell.v;
  switch (inferred.type) {
    case "date":
    case "datetime": {
      const iso = inferred.yearMonth
        ? yearMonthOf(cell.t === "n" ? (raw as number) : (parseNumber(String(raw), inferred.decimal)?.value ?? Number.NaN))
        : cell.t === "d"
          ? String(raw).replace("T", " ")
          : cell.t === "n"
            ? serialToDate(raw as number)?.iso
            : parseDate(String(raw), inferred.dates?.order ?? "dmy")?.iso;
      if (!iso) return undefined;
      return inferred.type === "date" ? iso.slice(0, 10) : iso.length === 10 ? `${iso} 00:00:00` : iso;
    }
    case "integer":
    case "decimal":
    case "currency":
    case "percent": {
      if (cell.t === "n") return raw as number;
      if (cell.t !== "s") return undefined;
      return parseNumber(String(raw), inferred.decimal)?.value;
    }
    case "boolean": {
      if (cell.t === "b") return raw as boolean;
      const w = String(raw).trim().toLowerCase();
      return TRUE_WORDS.has(w) ? true : FALSE_WORDS.has(w) ? false : undefined;
    }
    default:
      return typeof raw === "string" ? raw.trim() : String(raw);
  }
}

/** `_period` key for an ISO date at the job grain. */
export function periodOf(iso: string, grain: Grain): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  switch (grain) {
    case "day":
      return iso.slice(0, 10);
    case "month":
      return iso.slice(0, 7);
    case "quarter":
      return `${y}-Q${Math.ceil(m / 3)}`;
    case "year":
      return String(y);
    case "week": {
      // ISO 8601 week: the week with the year's first Thursday is week 1.
      const date = new Date(Date.UTC(y, m - 1, d));
      const day = (date.getUTCDay() + 6) % 7;
      date.setUTCDate(date.getUTCDate() - day + 3);
      const weekYear = date.getUTCFullYear();
      const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
      const week =
        1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
      return `${weekYear}-W${String(week).padStart(2, "0")}`;
    }
  }
}

export function normalizeTable(t: TableRegion, grain: Grain = "month"): NormalizeResult {
  const names = columnNames(t.columns.map((c) => c.name));
  const detail = t.rows.filter((r) => !r.is_total);
  const inferred = t.columns.map((c, i) =>
    inferColumn(
      c.name,
      detail.map((r) => r.cells[i]),
    ),
  );
  const issues: ColumnIssue[] = [];
  const columns: NormalizedColumn[] = t.columns.map((c, i) => {
    const inf = inferred[i];
    return {
      name: names[i] ?? `column_${i + 1}`,
      label: c.name,
      letter: c.letter,
      type: inf?.type ?? "text",
      ...(inf?.currency ? { currency: inf.currency } : {}),
    };
  });
  for (const [i, inf] of inferred.entries()) {
    const col = columns[i];
    if (!col) continue;
    for (const issue of inf.issues) {
      // Date issues point at the values that could be read either way; others at the first detail row.
      const ambiguousRows = detail
        .filter((r) => {
          const v = r.cells[i]?.v;
          return typeof v === "string" && dateOrderEvidence(v) === "ambiguous";
        })
        .map((r) => r.row);
      const rows = issue.kind.startsWith("date_format") && ambiguousRows.length ? ambiguousRows : detail.slice(0, 1).map((r) => r.row);
      issues.push({
        ...issue,
        column: col.name,
        letter: col.letter,
        rows: rows.slice(0, 20),
        details: { ...issue.details, affected_rows: rows.length },
      });
    }
  }

  // `_period` comes from the first date column, preferring a date-named header.
  const dateCols = columns.map((c, i) => ({ c, i })).filter(({ c }) => c.type === "date" || c.type === "datetime");
  const periodCol = dateCols.find(({ c }) => DATE_HEADER.test(c.label)) ?? dateCols[0];

  const unparseable = new Map<number, number[]>();
  const rows: NormalizedRow[] = t.rows.map((r) => {
    const values = r.cells.map((cell, i) => {
      const inf = inferred[i];
      const v = inf ? normalizeCell(cell, inf) : null;
      if (v === undefined) {
        // Push in place: copying the list per bad cell is quadratic in the number of bad cells.
        const bad = unparseable.get(i);
        if (bad) bad.push(r.row);
        else unparseable.set(i, [r.row]);
        return null;
      }
      return v;
    });
    const p = periodCol ? values[periodCol.i] : null;
    return { row: r.row, is_total: r.is_total, period: typeof p === "string" ? periodOf(p, grain) : null, values };
  });

  // Mixed-currency columns get a companion column with each row's currency (spec §6: kept separate, flagged,
  // never converted), so later SQL can group or filter by currency instead of adding USD to UZS.
  const mixed = inferred.map((inf, i) => (inf.issues.some((x) => x.kind === "mixed_currency") ? i : -1)).filter((i) => i >= 0);
  const taken = new Set(columns.map((c) => c.name));
  for (const i of mixed) {
    const col = columns[i];
    if (!col) continue;
    // Identifiers are capped at 63 characters: leave room for "_currency" and a numeric suffix.
    const stem = col.name.slice(0, 50);
    let name = `${stem}_currency`;
    for (let k = 2; taken.has(name); k++) name = `${stem}_currency_${k}`;
    taken.add(name);
    columns.push({ name, label: `${col.label} (currency)`, letter: col.letter, type: "category" });
    rows.forEach((r, j) => {
      const cell = t.rows[j]?.cells[i];
      const code =
        cell?.t === "s"
          ? parseNumber(String(cell.v), inferred[i]?.decimal ?? ".")?.currency
          : typeof cell?.z === "string"
            ? detectCurrency(cell.z)
            : undefined;
      (r.values as NormalizedValue[]).push(code ?? null);
    });
  }
  for (const [i, bad] of unparseable) {
    const col = columns[i];
    if (!col) continue;
    issues.push({
      kind: "unparseable_value",
      severity: "low",
      message: `${bad.length} value(s) in "${col.label}" don't fit its ${col.type} type and were left empty`,
      column: col.name,
      letter: col.letter,
      rows: bad.slice(0, 20),
    });
  }

  return {
    table: {
      id: t.id,
      file_id: t.file_id,
      ...(t.sheet !== undefined ? { sheet: t.sheet } : {}),
      range: t.range,
      hidden_sheet: t.hidden_sheet,
      header_rows: t.header_rows,
      notes: t.notes,
      transposed: t.transposed,
      columns,
      rows,
    },
    issues,
    ...(periodCol ? { periodColumn: periodCol.c.name } : {}),
  };
}
