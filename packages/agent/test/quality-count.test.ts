// The row counts grouped quality items state (quality.sql.ts): the same predicates as the profile rules, counted.
// Hand-built table; expected counts worked out by hand below.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql, Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { qualityCount } from "../src/quality.sql.ts";

const dir = mkdtempSync(join(tmpdir(), "aa-qcount-"));
let ws: Workspace;
beforeAll(async () => {
  ws = await Workspace.open(join(dir, "job.duckdb"));
  await ws.run(sql`CREATE TABLE t_t1 (_row INTEGER, _is_total BOOLEAN, invoice VARCHAR, quantity DOUBLE, customer VARCHAR, amount DOUBLE)`);
  // Rows: 1 plain, 2 C-prefixed, 1 A-prefixed, 1 total row (excluded everywhere).
  await ws.run(sql`INSERT INTO t_t1 VALUES
    (1, false, '1001', 2, 'k1', 10),
    (2, false, 'C1002', -1, NULL, NULL),
    (3, false, 'C1003', -2, 'k2', 5),
    (4, false, 'A1004', 3, NULL, 7),
    (5, true, 'C9999', -9, NULL, NULL)`);
});
afterAll(async () => {
  await ws.close();
  rmSync(dir, { recursive: true, force: true });
});

const count = async (kind: string, column: string, prefixes: string[] = []) => {
  const q = qualityCount(kind, "T1", column, prefixes);
  return q ? Number((await ws.one<{ value: number }>(q))?.value) : undefined;
};

describe("quality row counts", () => {
  it("counts negative quantities, missing ids and missing values on detail rows only", async () => {
    expect(await count("negative_quantity", "quantity")).toBe(2); // rows 2, 3 (row 5 is a total)
    expect(await count("missing_id", "customer")).toBe(2); // rows 2, 4
    expect(await count("missing_value", "amount")).toBe(1); // row 2
  });

  it("counts only the prefixes the profile flagged", async () => {
    expect(await count("prefixed_id", "invoice", ["C"])).toBe(2); // C1002, C1003 (C9999 is a total)
    expect(await count("prefixed_id", "invoice", ["C", "A"])).toBe(3);
    expect(await count("prefixed_id", "invoice", [])).toBe(0);
    expect(await count("unit_error", "amount")).toBeUndefined();
  });
});
