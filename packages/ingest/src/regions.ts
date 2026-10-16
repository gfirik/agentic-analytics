// Table-region detection (docs/specs/ingestion-and-profiling.md §3). Real sheets hold titles, notes,
// several tables, spacer rows, merged headers and totals; this turns a cell grid into clean tables.
import { addr, colLetter, rangeA1 } from "./a1.ts";
import type { Cell, TableColumn, TableRow } from "./types.ts";

export interface Grid {
  readonly sheet?: string;
  readonly hidden: boolean;
  /** Sheet coordinates of cells[0][0] (0-based). */
  readonly r0: number;
  readonly c0: number;
  readonly cells: (Cell | undefined)[][];
  /** Merged ranges in sheet coordinates (0-based, inclusive). */
  readonly merges: readonly { s: { r: number; c: number }; e: { r: number; c: number } }[];
}

export interface DetectedTable {
  readonly sheet?: string;
  readonly hidden_sheet: boolean;
  readonly range: string;
  readonly header_rows: number[];
  readonly columns: TableColumn[];
  readonly rows: TableRow[];
  readonly transposed: boolean;
  readonly notes: string[];
}

export interface DetectOptions {
  /** CSV/TSV: the first non-empty row is the header (no merges or titles to reason about). */
  readonly headerFirstRow?: boolean;
}

interface Box {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

interface Layout {
  readonly box: Box;
  readonly topNotes: number[];
  readonly headerRows: number[];
  readonly dataRows: number[];
  readonly bottomNotes: number[];
  readonly cols: number[];
}

const TOTAL_WORDS = /^(grand\s+)?(sub\s*-?\s*)?totals?\b|^итого|^всего|^jami\b|^sum\b|^summa\b/i;
const MIN_DATA_ROWS = 3;
const MIN_COLS = 2;
const MIN_TYPE_SHARE = 0.8;

/** Grid with merged ranges unmerged: every cell of a merge carries the top-left value (spec §3.3). */
class View {
  readonly cells: (Cell | undefined)[][];
  readonly mergedAcross = new Set<string>(); // "r,c" of cells inside a horizontal merge
  constructor(readonly grid: Grid) {
    this.cells = grid.cells.map((row) => [...row]);
    for (const m of grid.merges) {
      const top = grid.cells[m.s.r - grid.r0]?.[m.s.c - grid.c0];
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          const rr = r - grid.r0;
          const cc = c - grid.c0;
          const row = this.cells[rr];
          if (!row) continue;
          if (top) row[cc] = top;
          if (m.e.c > m.s.c) this.mergedAcross.add(`${rr},${cc}`);
        }
      }
    }
  }
  get nRows(): number {
    return this.cells.length;
  }
  get nCols(): number {
    return Math.max(0, ...this.cells.map((r) => r.length));
  }
  cell(r: number, c: number): Cell | undefined {
    return this.cells[r]?.[c];
  }
  occupied(r: number, c: number): boolean {
    const v = this.cells[r]?.[c]?.v;
    return v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "");
  }
}

export function detectTables(grid: Grid, options: DetectOptions = {}): DetectedTable[] {
  const view = new View(grid);
  const out: DetectedTable[] = [];
  for (const box of components(view)) {
    for (const part of split(view, box, options)) {
      const layout = analyze(view, part, options);
      if (layout && qualifies(view, layout)) out.push(build(view, layout));
    }
  }
  return out.sort((a, b) => rowOf(a.range) - rowOf(b.range) || colOf(a.range).localeCompare(colOf(b.range)));
}

/** Connected regions of occupied cells; a gap of one empty row or column still connects (spec §3.1). */
function components(view: View): Box[] {
  const seen = new Set<number>();
  const W = view.nCols;
  const boxes: Box[] = [];
  for (let r = 0; r < view.nRows; r++) {
    for (let c = 0; c < W; c++) {
      if (!view.occupied(r, c) || seen.has(r * W + c)) continue;
      const box: Box = { r0: r, r1: r, c0: c, c1: c };
      const stack = [[r, c] as const];
      seen.add(r * W + c);
      while (stack.length) {
        const [cr, cc] = stack.pop() ?? [0, 0];
        box.r0 = Math.min(box.r0, cr);
        box.r1 = Math.max(box.r1, cr);
        box.c0 = Math.min(box.c0, cc);
        box.c1 = Math.max(box.c1, cc);
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const nr = cr + dr;
            const nc = cc + dc;
            if (nr < 0 || nc < 0 || nc >= W || seen.has(nr * W + nc) || !view.occupied(nr, nc)) continue;
            seen.add(nr * W + nc);
            stack.push([nr, nc]);
          }
        }
      }
      boxes.push(box);
    }
  }
  return boxes;
}

function trim(view: View, b: Box): Box | undefined {
  let { r0, r1, c0, c1 } = b;
  const rowEmpty = (r: number) => cols(c0, c1).every((c) => !view.occupied(r, c));
  const colEmpty = (c: number) => rows(r0, r1).every((r) => !view.occupied(r, c));
  while (r0 <= r1 && rowEmpty(r0)) r0++;
  while (r1 >= r0 && rowEmpty(r1)) r1--;
  while (c0 <= c1 && colEmpty(c0)) c0++;
  while (c1 >= c0 && colEmpty(c1)) c1--;
  return r0 <= r1 && c0 <= c1 ? { r0, r1, c0, c1 } : undefined;
}

/**
 * The one-cell gap tolerance joins side-by-side or stacked tables separated by a single blank column/row.
 * Split there when both sides are tables on their own and the far side starts a new table: a label/date
 * column or repeated header names to the right, or its own header row below. A blank spacer column or row
 * inside one table fails those tests and stays joined.
 */
function split(view: View, box: Box, options: DetectOptions): Box[] {
  const b = trim(view, box);
  if (!b) return [];
  for (let c = b.c0 + 1; c < b.c1; c++) {
    if (rows(b.r0, b.r1).some((r) => view.occupied(r, c))) continue;
    const left = trim(view, { ...b, c1: c - 1 });
    const right = trim(view, { ...b, c0: c + 1 });
    if (!left || !right) continue;
    const L = analyze(view, left, options);
    const R = analyze(view, right, options);
    if (L && R && qualifies(view, L) && qualifies(view, R) && startsNewTable(view, L, R)) {
      return [...split(view, left, options), ...split(view, right, options)];
    }
  }
  for (let r = b.r0 + 1; r < b.r1; r++) {
    if (cols(b.c0, b.c1).some((c) => view.occupied(r, c))) continue;
    const top = trim(view, { ...b, r1: r - 1 });
    const bottom = trim(view, { ...b, r0: r + 1 });
    if (!top || !bottom) continue;
    const T = analyze(view, top, options);
    const B = analyze(view, bottom, options);
    if (T && B && qualifies(view, T) && qualifies(view, B) && B.headerRows.length > 0) {
      return [...split(view, top, options), ...split(view, bottom, options)];
    }
  }
  return [b];
}

function startsNewTable(view: View, left: Layout, right: Layout): boolean {
  const first = right.cols[0] ?? right.box.c0;
  const firstValues = right.dataRows.map((r) => view.cell(r, first)).filter((x) => x && x.v !== null);
  const labelColumn = firstValues.length > 0 && firstValues.filter((x) => x?.t === "s" || x?.t === "d").length / firstValues.length >= 0.8;
  const names = (l: Layout) => new Set(l.cols.map((c) => headerName(view, l.headerRows, c)).filter(Boolean));
  const leftNames = names(left);
  const repeated = [...names(right)].some((n) => leftNames.has(n));
  return labelColumn || repeated;
}

function isString(cell: Cell | undefined): boolean {
  return cell?.t === "s" && typeof cell.v === "string" && cell.v.trim() !== "";
}

function occupiedCount(view: View, r: number, b: Box): number {
  return cols(b.c0, b.c1).filter((c) => view.occupied(r, c)).length;
}

function stringy(view: View, r: number, b: Box): boolean {
  const occ = occupiedCount(view, r, b);
  const strings = cols(b.c0, b.c1).filter((c) => isString(view.cell(r, c))).length;
  return strings >= 2 && strings / occ >= 0.6;
}

function analyze(view: View, b: Box, options: DetectOptions): Layout | undefined {
  const all = rows(b.r0, b.r1).filter((r) => occupiedCount(view, r, b) > 0);
  const width = b.c1 - b.c0 + 1;
  if (width < MIN_COLS) return undefined;
  let i = 0;
  const topNotes: number[] = [];
  // Titles and notes above the table: rows with a single filled cell (spec §3, "notes above the table").
  while (!options.headerFirstRow && i < all.length && isNoteRow(view, all[i] ?? 0, b)) topNotes.push(all[i++] ?? 0);
  const body = all.slice(i);
  if (!body.length) return undefined;

  const headerRows: number[] = [];
  const h = body[0] ?? 0;
  if (options.headerFirstRow || stringy(view, h, b)) {
    headerRows.push(h);
    // Stacked header rows under a row with merged parents or gaps ("Sales" over "Revenue | Orders").
    for (let k = 1; k < 3 && k < body.length - 1; k++) {
      const prev = body[k - 1] ?? 0;
      const next = body[k] ?? 0;
      if (next !== prev + 1 || options.headerFirstRow || !stringy(view, next, b)) break;
      const parentMerged = cols(b.c0, b.c1).some((c) => view.mergedAcross.has(`${prev},${c}`));
      const parentGaps = cols(b.c0, b.c1).some((c) => !view.occupied(prev, c) && view.occupied(next, c));
      const restAllStringy = body.slice(k + 1).every((r) => stringy(view, r, b));
      if (!(parentMerged || parentGaps) || restAllStringy) break;
      headerRows.push(next);
    }
  }
  let dataRows = body.slice(headerRows.length);
  const bottomNotes: number[] = [];
  // Notes under the table: trailing single-cell text rows in the first column ("Source: …").
  while (width >= 3 && dataRows.length) {
    const last = dataRows[dataRows.length - 1] ?? 0;
    const only = cols(b.c0, b.c1).filter((c) => view.occupied(last, c));
    if (only.length === 1 && only[0] === b.c0 && isString(view.cell(last, b.c0)) && !TOTAL_WORDS.test(String(view.cell(last, b.c0)?.v))) {
      bottomNotes.unshift(last);
      dataRows = dataRows.slice(0, -1);
    } else break;
  }
  const columns = cols(b.c0, b.c1).filter((c) => [...headerRows, ...dataRows].some((r) => view.occupied(r, c)));
  return { box: b, topNotes, headerRows, dataRows, bottomNotes, cols: columns };
}

/**
 * Spec §3.2: ≥ 2 columns, ≥ 3 data rows, and type consistency below the header — at least two columns whose
 * filled cells share one type (≥ 80%, total rows excluded). Free-form text blocks and scattered notes fail this.
 */
function isNoteRow(view: View, r: number, b: Box): boolean {
  const filled = cols(b.c0, b.c1).filter((c) => view.occupied(r, c));
  // Any single-cell row above the header (title, date, note) is kept in `notes`, never dropped silently.
  return filled.length === 1;
}

function qualifies(view: View, l: Layout): boolean {
  if (l.dataRows.length < MIN_DATA_ROWS) return false;
  const detail = l.dataRows.filter((r) => !isKeywordTotal(view, r, l.cols));
  const consistent = l.cols.filter((c) => {
    const types = detail.filter((r) => view.occupied(r, c)).map((r) => view.cell(r, c)?.t ?? "z");
    if (!types.length) return false;
    const counts = new Map<string, number>();
    for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
    return Math.max(...counts.values()) / types.length >= MIN_TYPE_SHARE;
  });
  return consistent.length >= MIN_COLS;
}

function isKeywordTotal(view: View, r: number, columns: readonly number[]): boolean {
  const label = columns
    .slice(0, 2)
    .map((c) => view.cell(r, c))
    .find((x) => isString(x));
  return label !== undefined && TOTAL_WORDS.test(String(label.v).trim());
}

function headerName(view: View, headerRows: readonly number[], c: number): string {
  const parts: string[] = [];
  for (const r of headerRows) {
    const v = view.cell(r, c)?.v;
    const s = v === null || v === undefined ? "" : String(v).trim().replace(/\s+/g, " ");
    if (s && parts[parts.length - 1] !== s) parts.push(s);
  }
  return parts.join(" / ");
}

const MONTHS = [
  ["jan", "january", "янв", "январь", "yanvar"],
  ["feb", "february", "фев", "февраль", "fevral"],
  ["mar", "march", "мар", "март", "mart"],
  ["apr", "april", "апр", "апрель", "aprel"],
  ["may", "май", "may"],
  ["jun", "june", "июн", "июнь", "iyun"],
  ["jul", "july", "июл", "июль", "iyul"],
  ["aug", "august", "авг", "август", "avgust"],
  ["sep", "sept", "september", "сен", "сентябрь", "sentyabr"],
  ["oct", "october", "окт", "октябрь", "oktyabr"],
  ["nov", "november", "ноя", "ноябрь", "noyabr"],
  ["dec", "december", "дек", "декабрь", "dekabr"],
].flat();

export function isPeriodLabel(cell: Cell | undefined): boolean {
  if (!cell || cell.v === null) return false;
  if (cell.t === "d") return true;
  if (typeof cell.v !== "string") return false;
  const s = cell.v.trim().toLowerCase().replace(/[.,]/g, "");
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(s) || /^(q[1-4])(\s+\d{4})?$/.test(s)) return true;
  const word = s.split(/[\s'-]+/)[0] ?? "";
  return MONTHS.includes(word);
}

function build(view: View, l: Layout): DetectedTable {
  const { box, headerRows, dataRows } = l;
  const notes = [...l.topNotes, ...l.bottomNotes].map((r) => {
    const c = cols(box.c0, box.c1).find((x) => view.occupied(r, x)) ?? box.c0;
    return String(view.cell(r, c)?.v ?? "").trim();
  });
  const names = dedupe(l.cols.map((c) => headerName(view, headerRows, c) || `column_${colLetter(c + view.grid.c0)}`));
  const sheetRow = (r: number) => r + view.grid.r0 + 1;
  const ref = (r: number, c: number) => addr(r + view.grid.r0, c + view.grid.c0);
  const empty: Cell = { v: null, t: "z" };
  const firstRow = headerRows[0] ?? dataRows[0] ?? box.r0;
  const lastRow = dataRows[dataRows.length - 1] ?? box.r1;
  const cFirst = l.cols[0] ?? box.c0;
  const cLast = l.cols[l.cols.length - 1] ?? box.c1;
  const range = rangeA1(firstRow + view.grid.r0, cFirst + view.grid.c0, lastRow + view.grid.r0, cLast + view.grid.c0);
  const totals = totalFlags(view, dataRows, l.cols);

  // Transposed: periods across the header, labels down the first column → pivot to long (spec §3.5).
  const [labelCol, ...rest] = l.cols;
  const periodCols = rest.filter((c) => headerRows.some((r) => isPeriodLabel(view.cell(r, c))));
  const labelsAreText = dataRows.every((r) => !view.occupied(r, labelCol ?? 0) || isString(view.cell(r, labelCol ?? 0)));
  if (headerRows.length && labelCol !== undefined && periodCols.length >= 3 && labelsAreText) {
    const h = headerRows[headerRows.length - 1] ?? 0;
    const pivoted: TableRow[] = [];
    for (const [i, r] of dataRows.entries()) {
      for (const c of rest) {
        const isPeriod = periodCols.includes(c);
        pivoted.push({
          row: sheetRow(r),
          cells: [view.cell(r, labelCol) ?? empty, view.cell(h, c) ?? empty, view.cell(r, c) ?? empty],
          is_total: (totals[i] ?? false) || !isPeriod,
          refs: [ref(r, labelCol), ref(h, c), ref(r, c)],
        });
      }
    }
    return {
      ...(view.grid.sheet !== undefined ? { sheet: view.grid.sheet } : {}),
      hidden_sheet: view.grid.hidden,
      range,
      header_rows: headerRows.map(sheetRow),
      columns: [
        { name: headerName(view, headerRows, labelCol) || "metric", letter: "" },
        { name: "period", letter: "" },
        { name: "value", letter: "" },
      ],
      rows: pivoted,
      transposed: true,
      notes,
    };
  }

  return {
    ...(view.grid.sheet !== undefined ? { sheet: view.grid.sheet } : {}),
    hidden_sheet: view.grid.hidden,
    range,
    header_rows: headerRows.map(sheetRow),
    columns: l.cols.map((c, i) => ({ name: names[i] ?? "", letter: colLetter(c + view.grid.c0) })),
    rows: dataRows.map((r, i) => ({ row: sheetRow(r), cells: l.cols.map((c) => view.cell(r, c) ?? empty), is_total: totals[i] ?? false })),
    transposed: false,
    notes,
  };
}

/**
 * Total and subtotal rows (spec §3.4): a total keyword in the first two columns, or — with an empty label —
 * numbers that equal the column sums of the rows above since the previous total (or of all detail rows).
 */
function totalFlags(view: View, dataRows: readonly number[], columns: readonly number[]): boolean[] {
  const flags: boolean[] = [];
  let since: number[] = [];
  const detail: number[] = [];
  for (const r of dataRows) {
    let total = isKeywordTotal(view, r, columns);
    if (!total && !view.occupied(r, columns[0] ?? 0)) {
      const numeric = columns.filter((c) => typeof view.cell(r, c)?.v === "number");
      const sums = (rs: number[]) => (c: number) =>
        rs.reduce((s, x) => s + (typeof view.cell(x, c)?.v === "number" ? (view.cell(x, c)?.v as number) : 0), 0);
      const matches = (rs: number[]) =>
        rs.length >= 2 &&
        numeric.length > 0 &&
        numeric.every((c) => Math.abs((view.cell(r, c)?.v as number) - sums(rs)(c)) <= 1e-9 * Math.max(1, Math.abs(sums(rs)(c))));
      total = matches(since) || matches(detail);
    }
    flags.push(total);
    if (total) since = [];
    else {
      since.push(r);
      detail.push(r);
    }
  }
  return flags;
}

function dedupe(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = seen.get(n) ?? 0;
    seen.set(n, k + 1);
    return k ? `${n} (${k + 1})` : n;
  });
}

function rows(a: number, b: number): number[] {
  return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
}
const cols = rows;

function rowOf(range: string): number {
  return Number(/\d+/.exec(range)?.[0] ?? 0);
}
function colOf(range: string): string {
  return /^[A-Z]+/.exec(range)?.[0]?.padStart(3, " ") ?? "";
}
