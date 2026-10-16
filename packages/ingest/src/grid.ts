// Spreadsheet → raw cell grids with SheetJS (spec §2). Formulas are never evaluated: the cached value is
// used, and a formula without one becomes an issue.
import * as XLSX from "xlsx";
import { addr } from "./a1.ts";
import { IngestError } from "./errors.ts";
import type { Grid } from "./regions.ts";
import type { Cell } from "./types.ts";

export const MAX_CELLS_PER_SHEET = 2_000_000;

export interface SheetIssue {
  readonly kind: "missing_cached_value" | "too_many_cells" | "hidden_sheet";
  readonly sheet: string;
  readonly cell?: string;
  readonly message: string;
}

export function readWorkbookGrids(bytes: Uint8Array): { grids: Grid[]; issues: SheetIssue[] } {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: "array", cellFormula: true, cellNF: true, cellDates: false, cellStyles: false, sheetStubs: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/password|encrypt/i.test(message)) throw new IngestError("PASSWORD", "the workbook is password-protected", { cause: err });
    throw new IngestError("UNREADABLE", `the workbook could not be read: ${message}`, { cause: err });
  }
  const grids: Grid[] = [];
  const issues: SheetIssue[] = [];
  wb.SheetNames.forEach((name, i) => {
    const ws = wb.Sheets[name];
    if (!ws?.["!ref"]) return;
    const hidden = (wb.Workbook?.Sheets?.[i]?.Hidden ?? 0) > 0;
    if (hidden) issues.push({ kind: "hidden_sheet", sheet: name, message: `sheet "${name}" is hidden; its tables are still read` });
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const nRows = range.e.r - range.s.r + 1;
    const nCols = range.e.c - range.s.c + 1;
    if (nRows * nCols > MAX_CELLS_PER_SHEET) {
      issues.push({
        kind: "too_many_cells",
        sheet: name,
        message: `sheet "${name}" spans ${nRows * nCols} cells (limit ${MAX_CELLS_PER_SHEET}); skipped`,
      });
      return;
    }
    const cells: (Cell | undefined)[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: (Cell | undefined)[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const raw = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
        const cell = raw ? toCell(raw) : undefined;
        if (raw?.f !== undefined && (raw.v === undefined || raw.v === null)) {
          issues.push({ kind: "missing_cached_value", sheet: name, cell: addr(r, c), message: `formula =${raw.f} has no cached value` });
        }
        row.push(cell);
      }
      cells.push(row);
    }
    grids.push({ sheet: name, hidden, r0: range.s.r, c0: range.s.c, cells, merges: ws["!merges"] ?? [] });
  });
  return { grids, issues };
}

function toCell(raw: XLSX.CellObject): Cell | undefined {
  const extra = { ...(raw.f !== undefined ? { f: raw.f } : {}), ...(typeof raw.z === "string" && raw.z !== "General" ? { z: raw.z } : {}) };
  // A formula without a cached value has no trustworthy value: empty, plus a missing_cached_value issue.
  if (raw.f !== undefined && (raw.v === undefined || raw.v === null)) return { v: null, t: "z", ...extra };
  switch (raw.t) {
    case "n":
      if (typeof raw.v !== "number") return raw.f !== undefined ? { v: null, t: "z", ...extra } : undefined;
      if (typeof raw.z === "string" && XLSX.SSF.is_date(raw.z)) return { v: serialToIso(raw.v), t: "d", ...extra };
      return { v: raw.v, t: "n", ...extra };
    case "s":
      return { v: String(raw.v ?? ""), t: "s", ...extra };
    case "b":
      return { v: Boolean(raw.v), t: "b", ...extra };
    case "d":
      return { v: raw.v instanceof Date ? raw.v.toISOString().slice(0, 10) : String(raw.v), t: "d", ...extra };
    case "e":
      return { v: raw.w ?? "#ERROR", t: "e", ...extra };
    default:
      return raw.f !== undefined ? { v: null, t: "z", ...extra } : undefined;
  }
}

/** Excel serial date → ISO date (or date-time when the serial has a time part). */
export function serialToIso(serial: number): string {
  const d = XLSX.SSF.parse_date_code(serial);
  const date = `${String(d.y).padStart(4, "0")}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  return d.H || d.M || d.S
    ? `${date}T${String(d.H).padStart(2, "0")}:${String(d.M).padStart(2, "0")}:${String(Math.floor(d.S)).padStart(2, "0")}`
    : date;
}
