import { describe, expect, it } from "vitest";
import { detectTables, type Grid } from "../src/index.ts";
import type { Cell } from "../src/types.ts";

const cell = (v: string | number | boolean | null): Cell | undefined =>
  v === null ? undefined : typeof v === "number" ? { v, t: "n" } : typeof v === "boolean" ? { v, t: "b" } : { v, t: "s" };
const grid = (rows: (string | number | boolean | null)[][]): Grid => ({
  hidden: false,
  r0: 0,
  c0: 0,
  cells: rows.map((r) => r.map(cell)),
  merges: [],
});

describe("detectTables", () => {
  it("reads a sheet too large to spread into Math.max (about 150k rows overflowed the call stack)", () => {
    const rows: (string | number)[][] = [["Item", "Amount"]];
    for (let i = 0; i < 200_000; i++) rows.push([`sku${i % 50}`, i]);
    const t = detectTables(grid(rows));
    expect(t.length).toBe(1);
    expect(t[0]?.range).toBe("A1:B200001");
  });

  it("rejects a block without type-consistent columns (spec §3.2)", () => {
    const scattered = grid([
      ["call back", 12, true],
      [3, "see note", "x"],
      [false, 4.5, 7],
      ["ok", "later", null],
    ]);
    expect(detectTables(scattered)).toEqual([]);
  });

  it("keeps a table whose columns are each one type, ignoring the total row", () => {
    const t = detectTables(
      grid([
        ["Item", "Amount"],
        ["A", 1],
        ["B", 2],
        ["C", 3],
        ["Total", 6],
      ]),
    );
    expect(t.map((x) => x.range)).toEqual(["A1:B5"]);
    expect(t[0]?.rows.map((r) => r.is_total)).toEqual([false, false, false, true]);
  });

  it("keeps a spacer column inside one table joined (no label column on its right)", () => {
    const t = detectTables(
      grid([
        ["Month", "Revenue", null, "Orders"],
        ["Jan", 100, null, 10],
        ["Feb", 110, null, 11],
        ["Mar", 120, null, 12],
      ]),
    );
    expect(t.map((x) => [x.range, x.columns.map((c) => c.name)])).toEqual([["A1:D4", ["Month", "Revenue", "Orders"]]]);
  });

  it("keeps a lone value above the header as a note, never dropping it", () => {
    const t = detectTables(
      grid([
        [2026, null],
        ["Name", "Score"],
        ["Ann", 7],
        ["Bob", 9],
        ["Cy", 6],
      ]),
    );
    expect(t[0]?.notes).toEqual(["2026"]);
    expect(t[0]?.range).toBe("A2:B5");
  });
});
