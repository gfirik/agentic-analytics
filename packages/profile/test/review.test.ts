// Tests added from the M3 review: per-row currency, missing periods at the data grain, entity similarity
// (hand-computed Jaro–Winkler), top values, key duplicates, rate-named columns, names and ISO dates.
import type { TableRegion } from "@agentic-analytics/ingest";
import { ident, loadTable, type NormalizedTable, sql, Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import { columnNames, matchEntities, normalizeTable, parseDate, profileTable, runRules, tokenOverlap } from "../src/index.ts";
import { similarPairs, topValues } from "../src/profile.sql.ts";

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});
async function loaded(t: NormalizedTable) {
  const ws = await Workspace.open();
  open.push(ws);
  await loadTable(ws, t);
  return ws;
}
const table = (columns: NormalizedTable["columns"], rows: (string | number | null)[][], id = "T1"): NormalizedTable => ({
  id,
  file_id: "F1",
  sheet: "S",
  range: "A1:C9",
  hidden_sheet: false,
  header_rows: [1],
  notes: [],
  transposed: false,
  columns,
  rows: rows.map((values, i) => ({ row: i + 2, is_total: false, period: null, values })),
});

describe("mixed currencies stay separate per row (spec §6)", () => {
  it("adds a companion currency column and never converts", async () => {
    const region: TableRegion = {
      id: "T1",
      file_id: "F1",
      sheet: "S",
      hidden_sheet: false,
      range: "A1:B5",
      header_rows: [1],
      columns: [
        { name: "Client", letter: "A" },
        { name: "Paid", letter: "B" },
      ],
      rows: [
        ["Acme", "$1,200"],
        ["Beta", "900 сум"],
        ["Gamma", "$300"],
        ["Delta", "$40"],
      ].map(([a, b], i) => ({
        row: i + 2,
        is_total: false,
        cells: [
          { v: a ?? "", t: "s" as const },
          { v: b ?? "", t: "s" as const },
        ],
      })),
      transposed: false,
      notes: [],
    };
    const n = normalizeTable(region).table;
    expect(n.columns.map((c) => c.name)).toEqual(["client", "paid", "paid_currency"]);
    const ws = await loaded(n);
    // USD: 1,200 + 300 + 40 = 1,540; UZS: 900 — grouped, never added together
    expect(await ws.all(sql`SELECT paid_currency AS c, sum(paid) AS s FROM ${ident("t_t1")} GROUP BY 1 ORDER BY 1`)).toEqual([
      { c: "USD", s: 1540 },
      { c: "UZS", s: 900 },
    ]);
  });
});

describe("missing periods at the data's grain (spec §5)", () => {
  const dates = (values: string[], id: string) =>
    table(
      [
        { name: "day", label: "Date", letter: "A", type: "date" },
        { name: "n", label: "N", letter: "B", type: "integer" },
      ],
      values.map((d) => [d, 1]),
      id,
    );

  it("daily data reports missing days", async () => {
    const t = dates(["2026-03-01", "2026-03-02", "2026-03-04", "2026-03-06"], "T1");
    const p = await profileTable(await loaded(t), t, "day");
    expect(p).toMatchObject({ grain: "day", missing_periods: ["2026-03-03", "2026-03-05"] });
  });

  it("weekly data (all Mondays) reports missing weeks by their Monday", async () => {
    // 2026-03-02, 03-09 and 03-23 are Mondays; the week of 03-16 is missing
    const t = dates(["2026-03-02", "2026-03-09", "2026-03-23"], "T2");
    const p = await profileTable(await loaded(t), t, "day");
    expect(p).toMatchObject({ grain: "week", missing_periods: ["2026-03-16"] });
  });

  it("monthly data reports missing months", async () => {
    const t = dates(["2026-01-01", "2026-02-01", "2026-04-01"], "T3");
    const p = await profileTable(await loaded(t), t, "day");
    expect(p).toMatchObject({ grain: "month", missing_periods: ["2026-03"] });
  });
});

describe("profiling SQL templates (hand-computed)", () => {
  it("top values: count descending, ties alphabetical, limited", async () => {
    const t = table([{ name: "c", label: "C", letter: "A", type: "category" }], [["b"], ["a"], ["b"], ["c"], ["a"], ["d"], ["b"]]);
    const ws = await loaded(t);
    // b×3, then a×2, then c×1 and d×1 in alphabetical order
    expect(await ws.all(topValues("t_t1", "c", 3))).toEqual([
      { value: "b", n: 3 },
      { value: "a", n: 2 },
      { value: "c", n: 1 },
    ]);
  });

  it("duplicates on the inferred key", async () => {
    const t = table(
      [
        { name: "order_id", label: "Order ID", letter: "A", type: "id" },
        { name: "amount", label: "Amount", letter: "B", type: "decimal" },
      ],
      [...Array.from({ length: 5 }, (_, i) => ["X1", i]), ...Array.from({ length: 3 }, (_, i) => ["X2", i]), ["X3", 9]],
    );
    const p = await profileTable(await loaded(t), t);
    // X1 five times → 4 extra, X2 three times → 2 extra, X3 once → 0: 4 + 2 = 6
    expect(p).toMatchObject({ key_columns: ["order_id"], key_duplicates: 6, duplicate_rows: 0 });
  });

  it("Jaro–Winkler pairs at or above the threshold", async () => {
    const ws = await Workspace.open();
    open.push(ws);
    const pairs = await ws.all<{ a: string; b: string; s: number }>(
      similarPairs(["green leaf bakery", "green leaf bakary", "office brew"], 0.92),
    );
    // 17 chars each, 16 matching, no transpositions: Jaro = (16/17 + 16/17 + 16/16) / 3 = 0.960784
    // Winkler: common prefix "gree" (4, capped) → 0.960784 + 4 × 0.1 × (1 − 0.960784) = 0.976471
    expect(pairs).toEqual([{ a: "green leaf bakary", b: "green leaf bakery", s: expect.closeTo(0.976471, 5) }]);
  });
});

describe("entity matching with typos", () => {
  it("links one-letter typos, with confidence = Jaro–Winkler to the canonical spelling", async () => {
    const t = table(
      [{ name: "customer", label: "Customer", letter: "A", type: "category" }],
      [["Cafe Bodrum"], ["Cafe Bodrum"], ["Cafe Bodrun"], ["Green Leaf Bakery"], ["Green Leaf Bakery"], ["Green Leaf Bakary"]],
    );
    const entities = await matchEntities(await loaded(t), [t]);
    const links = Object.fromEntries(entities.flatMap((e) => e.links.map((l) => [l.raw_value, [e.canonical_name, l.confidence]])));
    // "cafe bodrum" vs "cafe bodrun": Jaro = (10/11 + 10/11 + 1) / 3 = 0.939394; prefix 4 → 0.939394 + 0.4 × 0.060606 = 0.963636
    expect(links["Cafe Bodrun"]?.[0]).toBe("Cafe Bodrum");
    expect(links["Cafe Bodrun"]?.[1]).toBeCloseTo(0.963636, 5);
    expect(links["Green Leaf Bakary"]?.[0]).toBe("Green Leaf Bakery");
    expect(links["Green Leaf Bakary"]?.[1]).toBeCloseTo(0.976471, 5);
    expect(entities).toHaveLength(2);
  });

  it("token overlap tolerates one typo in tokens of four or more letters, never in numbers", () => {
    expect(tokenOverlap("cafe bodrum", "cafe bodrun")).toBe(1);
    expect(tokenOverlap("cafe bodrum", "cafe ankara")).toBeCloseTo(1 / 3, 10);
    expect(tokenOverlap("pack 250g", "pack 260g")).toBeCloseTo(1 / 3, 10);
  });
});

describe("smaller review fixes", () => {
  it("rate-named plain numbers above 100 are flagged", async () => {
    const t = table([{ name: "margin_pct", label: "Margin %", letter: "A", type: "decimal" }], [[12.5], [140], [30]]);
    const ws = await loaded(t);
    const issues = await runRules(ws, t, await profileTable(ws, t), "2026-07-01");
    expect(issues.map((i) => [i.kind, i.row])).toEqual([["rate_above_100", 3]]);
  });

  it("column names stay unique even when a label looks suffixed", () => {
    expect(columnNames(["x", "x", "x_2"])).toEqual(["x", "x_2", "x_2_2"]);
  });

  it("ISO dates must be the whole value", () => {
    expect(parseDate("2026-01-05abc")).toBeUndefined();
    expect(parseDate("2026-01-05T10:00:00Z")?.iso).toBe("2026-01-05 10:00:00");
  });
});
