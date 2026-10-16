import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fragment, ident, loadJob, MIGRATIONS, type NormalizedTable, StoreError, sql, tableName, Workspace } from "../src/index.ts";

const open: Workspace[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.close();
});
const ws = async (path?: string) => {
  const w = await Workspace.open(path);
  open.push(w);
  return w;
};

const table: NormalizedTable = {
  id: "T1",
  file_id: "F1",
  sheet: "Monthly",
  range: "A1:C4",
  hidden_sheet: false,
  header_rows: [1],
  notes: ["Sales 2026"],
  transposed: false,
  columns: [
    { name: "month", label: "Month", letter: "A", type: "date" },
    { name: "revenue", label: "Revenue", letter: "B", type: "currency", currency: "USD" },
    { name: "channel", label: "Channel", letter: "C", type: "category" },
  ],
  rows: [
    { row: 2, is_total: false, period: "2026-01", values: ["2026-01-01", 41200, "retail"] },
    { row: 3, is_total: false, period: "2026-02", values: ["2026-02-01", 42900.5, "wholesale"] },
    { row: 4, is_total: true, period: null, values: [null, 84100.5, null] },
  ],
};

describe("sql tagged template", () => {
  it("turns values into numbered parameters and splices fragments", () => {
    const where = sql`month >= ${"2026-01"} AND channel = ${"retail"}`;
    const q = sql`SELECT sum(revenue) FROM ${ident("t_t1")} WHERE ${fragment(where)} AND _row > ${1}`;
    expect(q.text).toBe('SELECT sum(revenue) FROM "t_t1" WHERE month >= $1 AND channel = $2 AND _row > $3');
    expect(q.params).toEqual(["2026-01", "retail", 1]);
  });

  it("rejects anything but snake_case identifiers", () => {
    expect(() => ident('t1"; DROP TABLE files; --')).toThrow(StoreError);
    expect(() => ident("Revenue")).toThrow(/not a safe SQL identifier/);
    expect(ident("t_t1").quoted).toBe('"t_t1"');
  });

  it("keeps hostile values as data, never SQL", async () => {
    const w = await ws();
    const hostile = "x'); DROP TABLE files; --";
    await w.run(sql`INSERT INTO entities VALUES (${"E1"}, ${"customer"}, ${hostile})`);
    expect((await w.one(sql`SELECT canonical_name AS n FROM entities`))?.n).toBe(hostile);
    expect(await w.all(sql`SELECT count(*) AS n FROM files`)).toEqual([{ n: 0 }]);
  });
});

describe("workspace", () => {
  it("creates every ARCHITECTURE §3 table through migrations", async () => {
    const w = await ws();
    const tables = (await w.all<{ t: string }>(sql`SELECT table_name AS t FROM information_schema.tables ORDER BY 1`)).map((r) => r.t);
    for (const t of [
      "files",
      "sources",
      "profile_columns",
      "profile_tables",
      "quality_issues",
      "entities",
      "entity_links",
      "metric_defs",
      "facts",
      "insights",
      "decompositions",
      "chunks",
      "extracts",
      "web_results",
      "claims",
      "verification",
      "events",
    ]) {
      expect(tables).toContain(t);
    }
    expect(await w.version()).toBe(MIGRATIONS.at(-1)?.version);
  });

  it("is one file per job and reopens without re-running migrations", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-store-"));
    try {
      const path = join(dir, "workspace.duckdb");
      const a = await Workspace.open(path);
      await a.run(sql`INSERT INTO entities VALUES ('E1', 'customer', 'Hotel Group')`);
      a.close();
      const b = await ws(path);
      expect(await b.all(sql`SELECT version FROM schema_migrations ORDER BY version`)).toEqual(
        MIGRATIONS.map((m) => ({ version: m.version })),
      );
      expect((await b.one(sql`SELECT canonical_name AS n FROM entities`))?.n).toBe("Hotel Group");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads a normalized table as typed columns plus _row, _is_total and _period", async () => {
    const w = await ws();
    await loadJob(w, {
      files: [{ id: "F1", name: "sales.xlsx", sha256: "a".repeat(64), mime: "x", kind: "xlsx", size: 10, status: "ingested" }],
      tables: [table],
      sections: [
        { id: "D1", file_id: "F1", kind: "document", page: 2, heading_path: ["Terms"], char_start: 0, char_end: 5, text: "Hello" },
      ],
      issues: [
        { id: "Q1", kind: "unit_error", severity: "high", message: "x1000", file_id: "F1", source_id: "T1", sheet: "Monthly", cell: "B3" },
      ],
    });
    const types = await w.all<{ c: string; t: string }>(
      sql`SELECT column_name AS c, data_type AS t FROM information_schema.columns WHERE table_name = ${tableName("T1")} ORDER BY ordinal_position`,
    );
    expect(types).toEqual([
      { c: "_row", t: "INTEGER" },
      { c: "_is_total", t: "BOOLEAN" },
      { c: "_period", t: "VARCHAR" },
      { c: "month", t: "DATE" },
      { c: "revenue", t: "DOUBLE" },
      { c: "channel", t: "VARCHAR" },
    ]);
    // 41,200 + 42,900.5 = 84,100.5 over the two detail rows; the total row is kept but flagged.
    expect(await w.one(sql`SELECT sum(revenue) AS s, count(*) AS n FROM ${ident("t_t1")} WHERE NOT _is_total`)).toEqual({
      s: 84100.5,
      n: 2,
    });
    expect(await w.one(sql`SELECT kind, sheet, range_a1, header_rows, notes FROM sources WHERE id = 'T1'`)).toEqual({
      kind: "table",
      sheet: "Monthly",
      range_a1: "A1:C4",
      header_rows: [1],
      notes: ["Sales 2026"],
    });
    expect(await w.one(sql`SELECT page, section, text FROM sources WHERE id = 'D1'`)).toEqual({
      page: 2,
      section: ["Terms"],
      text: "Hello",
    });
    expect(await w.one(sql`SELECT kind, cell FROM quality_issues`)).toEqual({ kind: "unit_error", cell: "B3" });
  });

  it("refuses to work after close", async () => {
    const w = await Workspace.open();
    w.close();
    await expect(w.all(sql`SELECT 1`)).rejects.toMatchObject({ code: "CLOSED" });
  });
});
