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
