// The held-out generated set (docs/specs/accuracy.md §9): deterministic, apart from the 30, and planting what its
// answer keys say. Also proves the 30 development datasets are byte-identical to what they were before it existed.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingest } from "@agentic-analytics/ingest";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { ARCHETYPES, answersYaml, generatedDatasets, HELDOUT_ARCHETYPES, HELDOUT_SMOKE, heldoutDatasets, manifest } from "../src/index.ts";

const held = heldoutDatasets();
const dev = generatedDatasets();
const byId = (id: string) => held.find((d) => d.id === id) as (typeof held)[number];
const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

/** CSV text → rows of cells (the generator quotes no field of these files). */
const csvRows = (bytes: Uint8Array | undefined) =>
  new TextDecoder()
    .decode(bytes)
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => l.split(","));
const sheetRows = (bytes: Uint8Array | undefined, sheet: string) =>
  XLSX.utils
    .sheet_to_json<unknown[]>(XLSX.read(bytes, { cellDates: true }).Sheets[sheet] as XLSX.WorkSheet, { header: 1, defval: null })
    .slice(1);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

describe("the 30 development datasets", () => {
  it("are byte-identical to before the held-out set: the same manifest and answer keys as pinned on main", () => {
    // The digests of evals/generator/manifest.json and of the 30 answers.yaml (in id order) as they were on main
    // before M14 PR 7. A generator change that touches any of the 30 fails here even if the manifest is rebuilt.
    // The manifest digest is over a canonical form (ids and file names sorted), as computed from main's manifest.json.
    const m = manifest(dev);
    const canon = Object.keys(m)
      .sort()
      .map((id) => [id, m[id]?.seed, Object.entries(m[id]?.files ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))]);
    expect(Object.keys(m)).toHaveLength(30);
    expect(sha(JSON.stringify(canon))).toBe("f0eefaf9037e2d6adcb896b510a6317985cb8a9548788deb1fba05b7293da147");
    const keys = [...dev].sort((a, b) => (a.id < b.id ? -1 : 1)).map((d) => answersYaml(d.answers));
    expect(sha(keys.join(""))).toBe("d087aa723b718f12c21d24a81a2f6314d9fcd3501f904a9e3454488b403f5363");
    expect(dev.every((d) => d.answers.split === undefined)).toBe(true);
  });
});

describe("held-out generated datasets", () => {
  it("are 14 apart from the 30: ten reseeded development datasets and two new archetypes in two variants", () => {
    expect(held).toHaveLength(14);
    expect(new Set(held.map((d) => d.id)).size).toBe(14);
    expect(held.every((d) => d.answers.split === "heldout")).toBe(true);
    const devIds = new Set(dev.map((d) => d.id));
    const devSeeds = new Set(dev.map((d) => d.answers.seed));
    expect(held.filter((d) => devIds.has(d.id) || devSeeds.has(d.answers.seed)).map((d) => d.id)).toEqual([]);
    // Every development archetype once with a new seed, and two archetypes no development dataset has.
    expect(held.filter((d) => d.id.endsWith("-heldout")).map((d) => d.answers.archetype)).toEqual(ARCHETYPES.map((a) => a.id));
    expect(HELDOUT_ARCHETYPES.filter((a) => ARCHETYPES.some((x) => x.id === a))).toEqual([]);
    expect(held.filter((d) => (HELDOUT_ARCHETYPES as readonly string[]).includes(d.answers.archetype)).map((d) => d.id)).toEqual([
      "tool_hire-v1",
      "tool_hire-v2",
      "car_wash-v1",
      "car_wash-v2",
    ]);
    expect(held.map((d) => d.id)).toContain(HELDOUT_SMOKE);
  });

  it("are byte-identical to the pinned held-out manifest, and their keys to the versioned answers.yaml", () => {
    const pinned = JSON.parse(readFileSync(join(import.meta.dirname, "..", "heldout-manifest.json"), "utf8")) as unknown;
    expect(manifest(held)).toEqual(pinned);
    for (const d of held)
      expect(answersYaml(d.answers), d.id).toBe(
        readFileSync(join(import.meta.dirname, "..", "..", "datasets", "heldout", d.id, "answers.yaml"), "utf8"),
      );
  });

  it("new archetypes use their own shape: no development column header, other currencies, grains and end dates", () => {
    // The 30's headers, except Qty (a quantity is called that everywhere).
    const devHeader = ["Date", "Order ID", "Customer", "Channel", "Product", "Amount", "Status"];
    const hire = sheetRows(byId("tool_hire-v1").files["hire-ledger.xlsx"], "Hires");
    expect(hire.length).toBeGreaterThan(5000);
    const header = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes).split("\n")[0]?.split(",") ?? [];
    for (const h of [header(byId("tool_hire-v2").files["hires.csv"]), header(byId("car_wash-v1").files["daily-takings.csv"])])
      expect(h.filter((c) => devHeader.includes(c))).toEqual([]);
    const currencies = new Set(ARCHETYPES.map((a) => a.currency));
    for (const id of ["tool_hire-v1", "car_wash-v1"]) expect(currencies.has(byId(id).answers.currency), id).toBe(false);
    expect(new Set(["tool_hire-v1", "tool_hire-v2", "car_wash-v1", "car_wash-v2"].map((id) => byId(id).answers.today))).toEqual(
      new Set(["2026-09-01", "2026-06-01", "2026-05-01"]),
    );
  });

  it("tool_hire-v1 plants what its key says: Eastgate's hires stop, Brookvale Homes' more than triple", () => {
    const d = byId("tool_hire-v1");
    const [p1, p2] = d.answers.planted;
    const rows = sheetRows(d.files["hire-ledger.xlsx"], "Hires");
    const month = (r: unknown[]) => iso(r[1]).slice(0, 7);
    const sum = (xs: unknown[][]) => xs.reduce((s, r) => s + Number(r[9] ?? 0), 0);
    const eastgate = rows.filter((r) => r[2] === "Eastgate");
    expect(eastgate.filter((r) => month(r) < (p1?.period as string)).length).toBeGreaterThan(1000);
    expect(eastgate.filter((r) => month(r) >= (p1?.period as string))).toEqual([]);
    expect(p1?.driver).toEqual({ dimension: "depot", member: "Eastgate" });
    // Brookvale Homes: the same months a year apart, before and after the agreement (no Christmas in either).
    const brookvale = (m: string) => sum(rows.filter((r) => r[3] === "Brookvale Homes" && month(r) === m));
    expect(p2?.period).toBe("2026-03");
    expect(brookvale("2026-04") / brookvale("2025-04")).toBeGreaterThan(3);
    expect(p2?.type).toBe("improvement");
  });

  it("tool_hire-v2 plants what its key says: Access grows, Ashdown Civils stops hiring", () => {
    const d = byId("tool_hire-v2");
    const [p1, p2] = d.answers.planted;
    const rows = csvRows(d.files["hires.csv"]);
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    // "3 Mar 2026" → "2026-03"
    const month = (r: string[]) => {
      const [, mon, year] = (r[1] as string).split(" ");
      return `${year}-${String(MONTHS.indexOf(mon as string) + 1).padStart(2, "0")}`;
    };
    const sum = (xs: string[][]) => xs.reduce((s, r) => s + Number(r[9] || 0), 0);
    const access = (m: string) => sum(rows.filter((r) => r[4] === "Access" && month(r) === m));
    const other = (m: string) => sum(rows.filter((r) => r[4] !== "Access" && r[3] !== "Ashdown Civils" && month(r) === m));
    expect(p1?.member).toEqual({ dimension: "equipment_group", member: "Access" });
    // Access share of revenue jumps at the expansion; the rest of the mix doesn't.
    expect(access("2026-02") / access("2026-01")).toBeGreaterThan(1.4);
    expect(other("2026-02") / other("2026-01")).toBeLessThan(1.1);
    const ashdown = rows.filter((r) => r[3] === "Ashdown Civils");
    expect(ashdown.filter((r) => month(r) < (p2?.period as string)).length).toBeGreaterThan(500);
    expect(ashdown.filter((r) => month(r) >= (p2?.period as string))).toEqual([]);
  });

  it("car_wash-v1 plants what its key says: Millbrook's refunds rise, Ringway loses almost half its washes", () => {
    const d = byId("car_wash-v1");
    const rows = csvRows(d.files["daily-takings.csv"]);
    const [p1, p2] = d.answers.planted;
    expect([p1?.metric, p1?.period, p2?.metric, p2?.period]).toEqual(["refund_rate", "2025-10", "revenue", "2026-03"]);
    const rate = (site: string, from: string, to: string) => {
      const xs = rows.filter((r) => r[1] === site && (r[0] as string) >= from && (r[0] as string) <= to);
      return xs.reduce((s, r) => s + Number(r[5]), 0) / xs.reduce((s, r) => s + Number(r[4]), 0);
    };
    expect(rate("Millbrook", "2025-04-01", "2025-09-30")).toBeLessThan(0.012);
    expect(rate("Millbrook", "2025-11-01", "2026-05-31")).toBeGreaterThan(0.028);
    expect(rate("Ringway", "2025-11-01", "2026-05-31")).toBeLessThan(0.012);
    const sales = (site: string, from: string, to: string) =>
      rows.filter((r) => r[1] === site && (r[0] as string) >= from && (r[0] as string) <= to).reduce((s, r) => s + Number(r[4]), 0);
    const ringway = sales("Ringway", "2026-03-02", "2026-05-31") / sales("Ringway", "2025-03-02", "2025-05-31");
    const westfield = sales("Westfield", "2026-03-02", "2026-05-31") / sales("Westfield", "2025-03-02", "2025-05-31");
    expect(ringway / westfield).toBeCloseTo(0.55, 1);
  });

  it("car_wash-v2 plants what its key says: Ultimate buyers trade down at flat total sales, Harbour Rd loses a third", () => {
    const d = byId("car_wash-v2");
    const rows = sheetRows(d.files["takings.xlsx"], "Takings").map((r) => [iso(r[0]), ...r.slice(1)]);
    const sum = (f: (r: unknown[]) => boolean) => rows.filter(f).reduce((s, r) => s + Number(r[4]), 0);
    const inMonth = (m: string) => (r: unknown[]) => String(r[0]).startsWith(m);
    const ultimate = (m: string) => sum((r) => inMonth(m)(r) && r[2] === "Ultimate");
    expect(ultimate("2025-10") / ultimate("2025-09")).toBeLessThan(0.6);
    const total = (m: string) => sum(inMonth(m));
    expect(Math.abs(total("2025-10") / total("2025-09") - 1)).toBeLessThan(0.08);
    const site = (s: string, m: string) => sum((r) => inMonth(m)(r) && r[1] === s);
    expect(
      site("Harbour Rd", "2026-04") / site("Harbour Rd", "2026-02") / (site("Westfield", "2026-04") / site("Westfield", "2026-02")),
    ).toBeCloseTo(0.68, 1);
  });

  it("put each quality issue at the cell its key names", () => {
    const cell = (id: string, kind: string) => {
      const d = byId(id);
      const q = d.answers.quality.find((x) => x.kind === kind);
      const [file, ref] = (q?.location ?? "").split("#");
      const [sheet, addr] = (ref ?? "").split("!");
      const ws = XLSX.read(d.files[file as string], { cellDates: true }).Sheets[sheet as string] as XLSX.WorkSheet;
      return (ws[addr as string] as XLSX.CellObject).v;
    };
    expect(cell("tool_hire-v1", "negative_quantity")).toBe(-2);
    expect(iso(cell("tool_hire-v1", "future_date")).slice(0, 4)).toBe("2062");
    expect(cell("car_wash-v2", "negative_quantity")).toBe(-3);
    // CSV keys name the column and first row: car_wash-v1's empty wash counts, tool_hire-v2's empty net amounts.
    const cw = byId("car_wash-v1");
    const cwRow = Number(/#D(\d+)/.exec(cw.answers.quality[0]?.location ?? "")?.[1]);
    const cwRows = csvRows(cw.files["daily-takings.csv"]);
    expect(cwRows[cwRow - 2]?.[3]).toBe("");
    expect(cwRows.filter((r) => r[3] === "")).toHaveLength(20);
    const th = byId("tool_hire-v2");
    const thRow = Number(/#J(\d+)/.exec(th.answers.quality[0]?.location ?? "")?.[1]);
    const thRows = csvRows(th.files["hires.csv"]);
    expect(thRows.slice(thRow - 2, thRow + 5).map((r) => r[9])).toEqual(Array(7).fill(""));
    expect(thRows.filter((r) => r[9] === "")).toHaveLength(7);
  });

  it("keep each D1 blip off every planted month and other distractor, and every new archetype's D1 off its seasonal months", () => {
    for (const d of held) {
      const d1 = d.answers.distractors.find((x) => x.id === "D1");
      const others = [...d.answers.planted, ...d.answers.distractors].filter((x) => x.id !== "D1").map((x) => x.period);
      expect(others, d.id).not.toContain(d1?.period);
    }
  });

  it("ingest cleanly: each new archetype variant gives its table and documents", async () => {
    for (const id of ["tool_hire-v1", "tool_hire-v2", "car_wash-v1", "car_wash-v2"]) {
      const d = byId(id);
      const r = await ingest(Object.entries(d.files).map(([name, bytes]) => ({ name, bytes })));
      expect(r.tables.length, id).toBeGreaterThanOrEqual(1);
      expect(r.documents.length, id).toBeGreaterThanOrEqual(3);
      expect(
        r.issues.filter((i) => i.severity === "high"),
        id,
      ).toEqual([]);
    }
  }, 60_000);
});
