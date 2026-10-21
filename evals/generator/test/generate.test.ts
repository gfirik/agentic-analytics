// The generator (docs/EVALS.md §1): 30 deterministic datasets whose answer keys match the data they describe.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingest } from "@agentic-analytics/ingest";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { ARCHETYPES, answersYaml, generateDataset, generatedDatasets, manifest } from "../src/index.ts";

const all = generatedDatasets();

describe("generated datasets", () => {
  it("are 30: ten archetypes in three variants, with unique ids", () => {
    expect(all).toHaveLength(30);
    expect(new Set(all.map((d) => d.id)).size).toBe(30);
    expect(new Set(all.map((d) => d.answers.archetype)).size).toBe(ARCHETYPES.length);
  });

  it("are byte-identical to the pinned manifest, and their answer keys to the versioned answers.yaml", () => {
    const pinned = JSON.parse(readFileSync(join(import.meta.dirname, "..", "manifest.json"), "utf8")) as unknown;
    expect(manifest(all)).toEqual(pinned);
    for (const d of all)
      expect(answersYaml(d.answers), d.id).toBe(
        readFileSync(join(import.meta.dirname, "..", "..", "datasets", "generated", d.id, "answers.yaml"), "utf8"),
      );
  });

  it("plant what the answer key says (recomputed from the orders)", () => {
    // saas-v2: orders.csv. The key client has no orders from P1's month; refunds rise from P2's month.
    const d = generateDataset(ARCHETYPES.find((a) => a.id === "saas") as (typeof ARCHETYPES)[number], 1);
    const lines = new TextDecoder().decode(d.files["orders.csv"]).trim().split("\n").slice(1);
    const rows = lines.map((l) => l.split(","));
    const [p1, p2] = d.answers.planted;
    const key = p1?.driver?.member as string;
    const month = (r: string[]) => (r[0] as string).slice(0, 7);
    const keyBefore = rows.filter((r) => r[2] === key && month(r) < (p1?.period as string)).length;
    const keyAfter = rows.filter((r) => r[2] === key && month(r) >= (p1?.period as string)).length;
    expect(keyBefore).toBeGreaterThan(0);
    expect(keyAfter).toBe(0);
    // Refunded share of counter orders: ~1% before the switch, ~3.5% after.
    const counter = rows.filter((r) => r[3] === "self-serve");
    const rate = (xs: string[][]) => xs.filter((r) => r[7] === "refunded").length / xs.length;
    const before = rate(counter.filter((r) => month(r) < (p2?.period as string)));
    const after = rate(counter.filter((r) => month(r) >= (p2?.period as string)));
    expect(before).toBeLessThan(0.02);
    expect(after).toBeGreaterThan(0.025);
    expect(p2?.metric).toBe("refund_rate");
  });

  it("the D1 blip is a 3% move for its member in its month, never on a December peak or another event's month", () => {
    for (const d of all) {
      const d1 = d.answers.distractors.find((x) => x.id === "D1");
      const others = [...d.answers.planted, ...d.answers.distractors].filter((x) => x.id !== "D1").map((x) => x.period);
      expect(others, d.id).not.toContain(d1?.period);
      if (d.id.endsWith("-v3")) expect(d1?.period.endsWith("-12"), d.id).toBe(false);
    }
    // saas-v3, from the rows: both counter customers share one channel total (0.6 and 0.4 of it), so the blip customer
    // runs at 0.4/0.6 of the other every month except D1's, where it is 3% higher.
    const d = generateDataset(ARCHETYPES.find((a) => a.id === "saas") as (typeof ARCHETYPES)[number], 2);
    const d1 = d.answers.distractors.find((x) => x.id === "D1");
    const blip = d1?.member?.member as string;
    const wb = XLSX.read(d.files["sales.xlsx"]);
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets.Orders as XLSX.WorkSheet, { header: 1 }).slice(1);
    const counter = ARCHETYPES.find((a) => a.id === "saas")?.counter as readonly string[];
    const sum = (customer: string, month: string) =>
      rows.filter((r) => r[2] === customer && String(r[0]).startsWith(month)).reduce((s, r) => s + Number(r[6]), 0);
    const ratio = (month: string) => sum(blip, month) / sum(counter[0] as string, month);
    const base = 0.4 / 0.6;
    expect(ratio(d1?.period as string) / base).toBeCloseTo(1.03, 3);
    for (const month of ["2025-12", "2026-02"]) expect(ratio(month) / base, month).toBeCloseTo(1, 3);
  });

  it("the typo is 1,000× its neighbours, at the cell the key names", () => {
    const d = all.find((x) => x.id === "clinic-v1");
    const q = d?.answers.quality.find((x) => x.kind === "unit_error");
    const [file, ref] = (q?.location ?? "").split("#");
    const [sheet, cell] = (ref ?? "").split("!");
    const ws = XLSX.read(d?.files[file as string]).Sheets[sheet as string] as XLSX.WorkSheet;
    const col = XLSX.utils
      .sheet_to_json<(string | number)[]>(ws, { header: 1 })
      .slice(1)
      .map((r) => Number(r[3]));
    const typo = Number((ws[cell as string] as XLSX.CellObject).v);
    expect(typo).toBeGreaterThan(500 * Math.max(...col.filter((v) => v !== typo)));
  });

  it("ingest cleanly: one variant of each kind gives its tables and documents", async () => {
    for (const id of ["agency-v1", "agency-v2", "agency-v3"]) {
      const d = all.find((x) => x.id === id);
      const r = await ingest(Object.entries(d?.files ?? {}).map(([name, bytes]) => ({ name, bytes })));
      expect(r.tables.length, id).toBeGreaterThanOrEqual(2);
      expect(r.documents.length, id).toBeGreaterThanOrEqual(3);
      expect(
        r.issues.filter((i) => i.severity === "high"),
        id,
      ).toEqual([]);
    }
  });
});
