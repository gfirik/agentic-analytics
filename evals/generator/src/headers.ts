// The header row of each table a generated dataset ships (docs/specs/accuracy.md §11): the roles eval labels the 30
// businesses once per header layout, and a test uses this to check that every dataset really has that layout.
import * as XLSX from "xlsx";
import type { Dataset } from "./generate.ts";

export interface TableHeaders {
  /** The file the table is in. */
  readonly file: string;
  /** The sheet name of a workbook table; a CSV file is the "Orders" table. */
  readonly table: string;
  readonly headers: readonly string[];
}

/** Every workbook sheet's first row, and the first line of orders.csv, in file order. Other files are not tables. */
export function tableHeaders(ds: Pick<Dataset, "files">): TableHeaders[] {
  const out: TableHeaders[] = [];
  for (const [file, bytes] of Object.entries(ds.files)) {
    if (file.endsWith(".xlsx")) {
      const wb = XLSX.read(bytes, { type: "array" });
      for (const table of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[table] as XLSX.WorkSheet, { header: 1 });
        out.push({ file, table, headers: (rows[0] ?? []).map(String) });
      }
    } else if (file.endsWith(".csv")) {
      // The generator quotes only fields with a comma, quote or newline; its headers have none.
      const first = new TextDecoder().decode(bytes).split("\n", 1)[0] ?? "";
      out.push({ file, table: "Orders", headers: first.split(",") });
    }
  }
  return out;
}
