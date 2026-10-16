import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingest } from "@agentic-analytics/ingest";
import { type NormalizedTable, sql, Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import { inRange, normalizeEntity, profileJob, profileTable, runRules, sameNumbers } from "../src/index.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const files = (...paths: string[]) =>
  paths.map((p) => ({ name: p.split("/").pop() ?? p, bytes: new Uint8Array(readFileSync(join(root, p))) }));
const COFFEE = ["sales-2026.xlsx", "price-list.pdf", "email-0412.eml", "ops-notes.docx"].map(
  (f) => `evals/datasets/coffee-roaster-v1/files/${f}`,
);

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});
const workspace = async () => {
  const w = await Workspace.open();
  open.push(w);
  return w;
};

const numbers = (values: (number | null)[], extra: Partial<NormalizedTable> = {}): NormalizedTable => ({
  id: "T1",
  file_id: "F1",
  sheet: "S",
  range: `A1:B${values.length + 1}`,
  hidden_sheet: false,
  header_rows: [1],
  notes: [],
  transposed: false,
  columns: [
    { name: "item", label: "Item", letter: "A", type: "category" },
    { name: "amount", label: "Amount", letter: "B", type: "decimal" },
  ],
  rows: values.map((v, i) => ({ row: i + 2, is_total: false, period: null, values: [`item ${i}`, v] })),
  ...extra,
});

async function loaded(t: NormalizedTable) {
  const ws = await workspace();
  const { loadTable } = await import("@agentic-analytics/store");
  await loadTable(ws, t);
  return ws;
}

describe("column profiling (hand-computed)", () => {
  it("null %, distinct, median, MAD and MAD outliers", async () => {
    // values 10, 12, 11, 13, 100 and one empty
    // median = 12; |deviations| = 2, 0, 1, 1, 88 → MAD = median(0, 1, 1, 2, 88) = 1
    // outlier score of 100: |100 − 12| / (1.4826 × 1) = 59.4 > 5; of 10: 2 / 1.4826 = 1.35
    const t = numbers([10, 12, 11, 13, 100, null]);
    const ws = await loaded(t);
    const p = await profileTable(ws, t);
    const amount = p.columns.find((c) => c.name === "amount");
    expect(amount).toMatchObject({ non_null: 5, distinct_count: 5, median: 12, mad: 1, outlier_rows: [6] });
    expect(amount?.null_pct).toBeCloseTo((1 / 6) * 100, 10);
    expect(p).toMatchObject({ row_count: 6, detail_rows: 6, total_rows: 0, duplicate_rows: 0 });
  });

  it("counts exact duplicate rows and date coverage with missing months", async () => {
    const t: NormalizedTable = {
      ...numbers([]),
      columns: [
        { name: "day", label: "Date", letter: "A", type: "date" },
        { name: "amount", label: "Amount", letter: "B", type: "decimal" },
      ],
      rows: [
        ["2026-01-05", 5],
        ["2026-01-05", 5],
        ["2026-03-07", 7],
        ["2026-04-01", 1],
      ].map((v, i) => ({ row: i + 2, is_total: false, period: null, values: v as [string, number] })),
    };
    const ws = await loaded(t);
    const p = await profileTable(ws, t, "day");
    // one repeated row; dates are not month starts → daily grain. Jan 5 … Apr 1 inclusive is
    // 27 + 28 + 31 + 1 = 87 days; 3 distinct days are present, so 84 are missing, starting Jan 6.
    expect(p.missing_periods).toHaveLength(84);
    expect(p.missing_periods.slice(0, 2)).toEqual(["2026-01-06", "2026-01-07"]);
    expect(p).toMatchObject({
      duplicate_rows: 1,
      date_first: "2026-01-05",
      date_last: "2026-04-01",
      grain: "day",
    });
  });
});

describe("implausibility rules", () => {
  it("flags an isolated ×1000 value but not a whole segment at a higher magnitude", async () => {
    // median of 12, 11, 13, 12, 12000 is 12; 12000 / 12 = 1000 → log10 = 3 exactly → ×1000
    const typo = numbers([12, 11, 13, 12, 12000]);
    const ws = await loaded(typo);
    const p = await profileTable(ws, typo);
    const issues = await runRules(ws, typo, p, "2026-07-01");
    expect(issues.map((i) => [i.kind, i.row, i.details.factor])).toEqual([["unit_error", 6, 1000]]);

    // 1,000 retail-sized values and 30 wholesale-sized ones (×100): a segment, not a typo
    const segment = numbers([...Array.from({ length: 1000 }, () => 27), ...Array.from({ length: 30 }, () => 2700)], { id: "T2" });
    const ws2 = await loaded(segment);
    const p2 = await profileTable(ws2, segment);
    expect(await runRules(ws2, segment, p2, "2026-07-01")).toEqual([]);
  });

  it("flags negative quantities, rates above 100% and future dates", async () => {
    const t: NormalizedTable = {
      ...numbers([]),
      columns: [
        { name: "qty", label: "Qty", letter: "A", type: "integer" },
        { name: "refund_rate", label: "Refund rate", letter: "B", type: "percent" },
        { name: "day", label: "Date", letter: "C", type: "date" },
      ],
      rows: [
        [3, 0.01, "2026-06-30"],
        [-2, 0.02, "2026-07-01"],
        [4, 1.5, "2026-07-02"],
      ].map((v, i) => ({ row: i + 2, is_total: false, period: null, values: v as [number, number, string] })),
    };
    const ws = await loaded(t);
    const p = await profileTable(ws, t);
    const issues = await runRules(ws, t, p, "2026-07-01");
    expect(issues.map((i) => [i.kind, i.letter, i.row])).toEqual([
      ["negative_quantity", "A", 3],
      ["rate_above_100", "B", 4],
      ["future_date", "C", 4],
    ]);
  });
});

describe("entity normalization", () => {
  it("strips legal forms, quotes and punctuation and transliterates", () => {
    expect(normalizeEntity("OOO Hotel Group")).toBe("hotel group");
    expect(normalizeEntity("Hotel Group LLC")).toBe("hotel group");
    expect(normalizeEntity("ООО «Ромашка»")).toBe("romashka");
    expect(normalizeEntity("Green Leaf Bakery, Ltd.")).toBe("green leaf bakery");
  });

  it("never links names that differ in a size, model or code", () => {
    expect(sameNumbers("espresso blend 1kg", "espresso blend 250g")).toBe(false);
    expect(sameNumbers("hotel group", "hotel groups")).toBe(true);
  });

  it("knows whether a cell lies in a range", () => {
    expect([inRange("J3", "H1:L7"), inRange("G3", "H1:L7"), inRange("A1", "A1")]).toEqual([true, false, true]);
  });
});

describe("M3 acceptance on coffee-roaster-v1", () => {
  const run = async () => {
    const ws = await workspace();
    const summary = await profileJob(ws, await ingest(files(...COFFEE)), { today: "2026-07-01" });
    return { ws, summary };
  };

  it("loads the dataset into the workspace", async () => {
    const { ws } = await run();
    expect(await ws.one(sql`SELECT count(*) AS n, sum(amount) FILTER (WHERE status <> 'refunded') AS revenue FROM t_t1`)).toEqual({
      n: 6260,
      revenue: expect.closeTo(237200, 6), // 41,200 + 42,900 + 44,100 + 36,200 + 35,800 + 37,000
    });
    expect(await ws.all(sql`SELECT _period, sum(wholesale) AS w FROM t_t2 GROUP BY 1 ORDER BY 1`)).toEqual([
      { _period: "2026-01", w: 14800 },
      { _period: "2026-02", w: 15300 },
      { _period: "2026-03", w: 15900 },
      { _period: "2026-04", w: 7400 },
      { _period: "2026-05", w: 7100 },
      { _period: "2026-06", w: 7300 },
    ]);
    expect(await ws.one(sql`SELECT count(*) AS n FROM sources WHERE kind IN ('document', 'email')`)).toEqual({ n: 9 });
  });

  it("finds the planted ×1000 packaging typo at Monthly!J3", async () => {
    const { summary } = await run();
    const unit = summary.issues.filter((i) => i.kind === "unit_error");
    expect(unit).toEqual([
      expect.objectContaining({
        sheet: "Monthly",
        cell: "J3",
        source_id: "T3",
        severity: "high",
        details: expect.objectContaining({ factor: 1000 }),
      }),
    ]);
  });

  it("finds the dd/mm date-format ambiguity in Orders, resolved day-first", async () => {
    const { summary, ws } = await run();
    const issue = summary.issues.find((i) => i.kind === "date_format_ambiguity");
    expect(issue).toMatchObject({
      source_id: "T1",
      sheet: "Orders",
      column_name: "date",
      severity: "low",
      details: expect.objectContaining({ order: "dmy", assumed: false }),
    });
    expect(await ws.one(sql`SELECT count(*) AS n FROM quality_issues WHERE kind = 'date_format_ambiguity'`)).toEqual({ n: 1 });
  });

  it("links “OOO Hotel Group” and “Hotel Group LLC” as one customer", async () => {
    const { summary, ws } = await run();
    const hotel = summary.entities.find((e) => e.links.some((l) => l.raw_value === "Hotel Group LLC"));
    expect(hotel?.kind).toBe("customer");
    expect(hotel?.links.map((l) => [l.raw_value, l.confidence]).sort()).toEqual([
      ["Hotel Group LLC", 0.99],
      ["OOO Hotel Group", 1],
    ]);
    expect(hotel?.canonical_name).toBe("OOO Hotel Group"); // 8 orders in Jan–Feb vs 4 in March
    const linked = await ws.all(sql`SELECT raw_value FROM entity_links WHERE entity_id = ${hotel?.id ?? ""} ORDER BY 1`);
    expect(linked).toEqual([{ raw_value: "Hotel Group LLC" }, { raw_value: "OOO Hotel Group" }]);
  });

  it("keeps different pack sizes as different products", async () => {
    const { summary } = await run();
    const products = summary.entities.filter((e) => e.kind === "product");
    expect(products.every((e) => e.links.length === 1)).toBe(true);
    expect(summary.assumptions).toEqual([]);
  });

  it("raises no false unit errors on the skewed Orders amounts (wholesale vs retail)", async () => {
    const { summary } = await run();
    expect(summary.issues.filter((i) => i.source_id === "T1" && i.kind === "unit_error")).toEqual([]);
  });
});
