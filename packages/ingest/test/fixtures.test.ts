// Every spreadsheet/CSV fixture must parse to its hand-written expected tables (ingestion spec §3 acceptance).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type IngestResult, ingest } from "../src/index.ts";

const root = join(import.meta.dirname, "..", "..", "..", "fixtures");

function project(res: IngestResult) {
  return {
    tables: res.tables.map((t) => ({
      sheet: t.sheet ?? null,
      range: t.range,
      hidden_sheet: t.hidden_sheet,
      header_rows: t.header_rows,
      columns: t.columns.map((c) => c.name),
      transposed: t.transposed,
      notes: t.notes,
      rows: t.rows.map((r) => [r.row, r.cells.map((c) => c.v), r.is_total]),
    })),
    issues: res.issues.map((i) => ({ kind: i.kind, ...(i.sheet ? { sheet: i.sheet } : {}), ...(i.cell ? { cell: i.cell } : {}) })),
  };
}

for (const dir of ["xlsx", "csv"]) {
  const files = readdirSync(join(root, dir)).filter((f) => f !== "expected");
  describe(`fixtures/${dir}`, () => {
    if (dir === "xlsx") it("has at least 12 nasty spreadsheets", () => expect(files.length).toBeGreaterThanOrEqual(12));
    for (const file of files) {
      it(file, async () => {
        const expected = JSON.parse(readFileSync(join(root, dir, "expected", `${file.replace(/\.[^.]+$/, "")}.json`), "utf8")) as unknown;
        const res = await ingest([{ name: file, bytes: new Uint8Array(readFileSync(join(root, dir, file))) }]);
        expect(project(res)).toEqual(expected);
      });
    }
  });
}

describe("transposed tables keep cell provenance", () => {
  it("each pivoted row points at its label, period header and value cells", async () => {
    const res = await ingest([{ name: "07.xlsx", bytes: new Uint8Array(readFileSync(join(root, "xlsx", "07-transposed.xlsx"))) }]);
    const feb = res.tables[0]?.rows.find((r) => r.cells[0]?.v === "Orders" && r.cells[1]?.v === "Feb");
    expect(feb?.refs).toEqual(["A3", "C1", "C3"]);
  });
});
