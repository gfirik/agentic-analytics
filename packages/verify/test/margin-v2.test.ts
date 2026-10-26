// A2 (docs/plans/m15.md): margin facts pass V2, a tampered margin fact fails it, and V4 holds a margin claim to a cost
// role. Part 1 is hand-built facts on the spec's two-product example (analysis-library §9, §10) with the arithmetic written
// out; part 2 runs the real pipeline on wholesale-margin-v1 and checks every fact it produced; part 3 is V4.
import { analyzeJob } from "@agentic-analytics/analysis";
import { wholesaleMarginExpectations, wholesaleMarginFiles } from "@agentic-analytics/eval-datasets";
import { ingest } from "@agentic-analytics/ingest";
import { loadCatalog, salesKpiPack, validateMetrics } from "@agentic-analytics/metrics";
import { periodOf, profileJob } from "@agentic-analytics/profile";
import type { Fact, MetricDef } from "@agentic-analytics/schema";
import { sql, Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recomputeFacts } from "../src/index.ts";
import { costRoleMetrics, marginClaimProblem, marginFactProblem } from "../src/margin-check.ts";

let ws: Workspace;
beforeAll(async () => {
  ws = await Workspace.open();
});
afterAll(() => ws.close());

// ── Part 1: hand-built facts ──────────────────────────────────────────────────────────────────────────────────

const all = new Map<string, Fact>();
let n = 0;
const measured = (label: string, value: number, metric: string): string => {
  const id = `P${++n}`;
  all.set(id, {
    id,
    label,
    value,
    unit: "currency",
    metric_id: metric,
    computation: { kind: "sql", sql: "SELECT 1" },
    citations: [],
    verified: false,
  });
  return id;
};
const fnFact = (
  label: string,
  value: number,
  fn: string,
  inputs: string[],
  metric = "gross_margin",
  unit: Fact["unit"] = "currency",
): Fact => {
  const id = `C${++n}`;
  const f: Fact = {
    id,
    label,
    value,
    unit,
    metric_id: metric,
    computation: { kind: "function", fn, inputs },
    citations: [],
    verified: false,
  };
  all.set(id, f);
  return f;
};
const mismatches = async (f: Fact) => (await recomputeFacts(ws, [f], all)).filter((r) => !r.ok);

describe("margin facts on the spec's two-product example", () => {
  // January: A 10 × 5 at cost 3, B 10 × 10 at cost 6. February: A 12 × 5 at cost 4, B 8 × 11 at cost 6.
  const rev0 = measured("revenue_2026-01", 150, "revenue");
  const cost0 = measured("cost_2026-01", 90, "cost");
  const rev1 = measured("revenue_2026-02", 148, "revenue");
  const cost1 = measured("cost_2026-02", 96, "cost");

  it("gross_margin = revenue − cost: 150 − 90 = 60 and 148 − 96 = 52", async () => {
    expect(await mismatches(fnFact("gross_margin_2026-01", 60, "gross_margin", [rev0, cost0]))).toEqual([]);
    expect(await mismatches(fnFact("gross_margin_2026-02", 52, "gross_margin", [rev1, cost1]))).toEqual([]);
  });

  it("gross_margin_pct = (revenue − cost) ÷ revenue × 100: 60 ÷ 150 = 40 and 52 ÷ 148 = 35.135135…", async () => {
    expect(
      await mismatches(fnFact("gross_margin_pct_2026-01", 40, "gross_margin_pct", [rev0, cost0], "gross_margin_pct", "percent")),
    ).toEqual([]);
    expect(
      await mismatches(
        fnFact("gross_margin_pct_2026-02", (52 / 148) * 100, "gross_margin_pct", [rev1, cost1], "gross_margin_pct", "percent"),
      ),
    ).toEqual([]);
  });

  it("a percentage over revenue ≤ 0 is never stated, so one that is stored is a mismatch", async () => {
    const r = measured("revenue_x", 0, "revenue");
    expect(await mismatches(fnFact("gross_margin_pct_x", 0, "gross_margin_pct", [r, cost0], "gross_margin_pct", "percent"))).toHaveLength(
      1,
    );
  });

  // Input groups (r0, q0, cost0, r1, q1, cost1): A = 50, 10, 30, 60, 12, 48 · B = 100, 10, 60, 88, 8, 48.
  const item = (key: string, v: number[]) =>
    ["r0", "q0", "cost0", "r1", "q1", "cost1"].map((k, i) => measured(`${k}[product=${key}]_2026-02`, v[i] as number, k));
  const six = [...item("A", [50, 10, 30, 60, 12, 48]), ...item("B", [100, 10, 60, 88, 8, 48])];
  const effects: [string, number][] = [
    ["volume", 0], // (20 − 20)·3
    ["mix", -4], // (12·2 + 8·4) − 20·3
    ["price", 8], // 12·0 + 8·1
    ["cost", -12], // −(12·1 + 8·0)
  ];

  it.each(effects)("pvm_margin.v1 %s = %d recomputes from the groups of six, and the effects sum to ΔM = −8", async (effect, value) => {
    expect(await mismatches(fnFact(`pvm_margin.${effect}_2026-02`, value, "pvm_margin.v1", six))).toEqual([]);
  });

  it("new, lost and unpriced read pairs and groups of four: C new 32 − 20, D lost −(40 − 24), E unpriced (10 − 0) − (30 − 18)", async () => {
    const c = [measured("r1[product=C]", 32, "r1"), measured("cost1[product=C]", 20, "cost1")];
    const d = [measured("r0[product=D]", 40, "r0"), measured("cost0[product=D]", 24, "cost0")];
    const e = ["r0", "cost0", "r1", "cost1"].map((k, i) => measured(`${k}[product=E]`, [30, 18, 10, 0][i] as number, k));
    expect(await mismatches(fnFact("pvm_margin.new_2026-02", 12, "pvm_margin.v1", c))).toEqual([]);
    expect(await mismatches(fnFact("pvm_margin.lost_2026-02", -16, "pvm_margin.v1", d))).toEqual([]);
    expect(await mismatches(fnFact("pvm_margin.unpriced_2026-02", -2, "pvm_margin.v1", e))).toEqual([]);
  });

  it("a tampered value (+0.01) is a mismatch for every margin function", async () => {
    const tampered = [
      fnFact("gross_margin_2026-01", 60.01, "gross_margin", [rev0, cost0]),
      fnFact("gross_margin_pct_2026-01", 40.01, "gross_margin_pct", [rev0, cost0], "gross_margin_pct", "percent"),
      ...effects.map(([effect, value]) => fnFact(`pvm_margin.${effect}_2026-02`, value + 0.01, "pvm_margin.v1", six)),
    ];
    for (const f of tampered) expect(await mismatches(f), f.label).toHaveLength(1);
  });

  it("an effect with no named effect in its label cannot be verified", async () => {
    expect(await mismatches(fnFact("pvm_margin_2026-02", 0, "pvm_margin.v1", six))).toHaveLength(1);
  });
});

// ── Part 2: the real pipeline on wholesale-margin-v1 ─────────────────────────────────────────────────────────

const csv = new TextDecoder().decode(wholesaleMarginFiles()["invoice-lines.csv"]);
const exp = wholesaleMarginExpectations();

/** The pipeline up to the facts: profile, the code-drafted pack, analysis. `before` leaves out the months from it on. */
async function run(before?: string) {
  const w = await Workspace.open();
  const text = csv
    .split("\n")
    .filter((l, i) => i === 0 || !before || l.slice(0, 7) < before)
    .join("\n");
  const summary = await profileJob(w, await ingest([{ name: "invoice-lines.csv", bytes: new TextEncoder().encode(text) }]), {
    today: exp.today,
  });
  const catalog = await loadCatalog(w);
  const defs = validateMetrics(salesKpiPack(summary).defs, catalog, { defaultCurrency: exp.currency }).accepted;
  const periods = summary.tables
    .flatMap((t) => (t.date_first && t.date_last ? [periodOf(t.date_first, summary.grain), periodOf(t.date_last, summary.grain)] : []))
    .sort();
  const result = await analyzeJob(w, defs, catalog, { from: periods[0] ?? "", to: periods.at(-1) ?? "", grain: summary.grain });
  return { w, defs, catalog, facts: result.facts, byLabel: new Map(result.facts.map((f) => [f.label, f])) };
}

describe("wholesale-margin-v1 end to end", () => {
  let full: Awaited<ReturnType<typeof run>>;
  let toMay: Awaited<ReturnType<typeof run>>;
  beforeAll(async () => {
    full = await run();
    toMay = await run("2026-06");
  }, 120_000);
  afterAll(() => {
    full.w.close();
    toMay.w.close();
  });

  it("every fact recomputes: 0 mismatches, with a fact of each margin function", async () => {
    for (const r of [full, toMay]) {
      const checks = await recomputeFacts(r.w, r.facts, new Map(r.facts.map((f) => [f.id, f])));
      expect(checks.filter((c) => !c.ok)).toEqual([]);
      const fns = new Set(r.facts.map((f) => f.computation.fn));
      for (const fn of ["gross_margin", "gross_margin_pct", "pvm_margin.v1"]) expect(fns.has(fn), fn).toBe(true);
    }
  });

  it("the squeeze month's effects are the planted ones (volume, mix, price, cost, sum)", () => {
    const e = exp.squeeze.pvm_margin;
    const at = (effect: string) => full.byLabel.get(`pvm_margin.${effect}_2026-03`)?.value;
    expect(at("volume")).toBeCloseTo(e.volume, 3);
    expect(at("mix")).toBeCloseTo(e.mix, 3);
    expect(at("price")).toBeCloseTo(e.price, 3);
    expect(at("cost")).toBeCloseTo(e.cost, 3);
    expect(full.byLabel.get("gross_margin_2026-03")?.value).toBeCloseTo(exp.squeeze.gross_margin["2026-03"] as number, 2);
    expect(full.byLabel.get("gross_margin_pct_2026-03")?.value).toBeCloseTo(exp.squeeze.gross_margin_pct["2026-03"] as number, 3);
  });

  it("the price event's effects are the planted ones when May is the latest month", () => {
    const e = exp.price_event.pvm_margin;
    const at = (effect: string) => toMay.byLabel.get(`pvm_margin.${effect}_2026-05`)?.value;
    expect(at("volume")).toBeCloseTo(e.volume, 3);
    expect(at("mix")).toBeCloseTo(e.mix, 3);
    expect(at("price")).toBeCloseTo(e.price, 3);
    expect(at("cost")).toBeCloseTo(e.cost, 3);
  });

  it("margin values are function facts whose inputs are revenue and cost of the same period", () => {
    const f = full.byLabel.get("gross_margin_2026-03") as Fact;
    const inputs = (f.computation.inputs ?? []).map((id) => full.facts.find((x) => x.id === id)?.label);
    expect(f.computation.kind).toBe("function");
    expect(inputs).toEqual(["revenue_2026-03", "cost_2026-03"]);
    for (const x of full.facts) expect(marginFactProblem(x, new Map(full.facts.map((y) => [y.id, y])), full.defs), x.label).toBeUndefined();
  });

  it("a tampered margin fact fails V2: gross margin, margin %, and one effect each +0.01", async () => {
    const all = new Map(full.facts.map((f) => [f.id, f]));
    for (const label of ["gross_margin_2026-03", "gross_margin_pct_2026-03", "pvm_margin.cost_2026-03"]) {
      const f = full.byLabel.get(label) as Fact;
      const bad = await recomputeFacts(full.w, [{ ...f, value: f.value + 0.01 }], all);
      expect(
        bad.filter((c) => !c.ok),
        label,
      ).toHaveLength(1);
    }
  });

  it("a margin fact whose inputs are the wrong terms is a V4 problem", () => {
    const all = new Map(full.facts.map((f) => [f.id, f]));
    const f = full.byLabel.get("gross_margin_2026-03") as Fact;
    const cost = full.byLabel.get("cost_2026-03") as Fact;
    const swapped: Fact = { ...f, computation: { ...f.computation, inputs: [cost.id, cost.id] } };
    expect(marginFactProblem(swapped, all, full.defs)).toMatch(/not built from revenue and cost/);
  });

  // ── Part 3: V4's cost-role check, both ways ───────────────────────────────────────────────────────────────

  it("V4: a claim that names margin passes when a fact is measured from a cost column, and fails when none is", async () => {
    const costMetrics = await costRoleMetrics(full.w, full.defs, full.catalog);
    expect([...costMetrics].sort()).toEqual(["cost", "gross_margin", "gross_margin_pct"]);
    const metricsOf = (id: string) => new Set([full.facts.find((f) => f.id === id)?.metric_id ?? ""]);
    const margin = (full.byLabel.get("gross_margin_2026-03") as Fact).id;
    const revenue = (full.byLabel.get("revenue_2026-03") as Fact).id;
    expect(marginClaimProblem("Gross margin was {{N1}}.", [margin], metricsOf, costMetrics)).toBeUndefined();
    expect(marginClaimProblem("Gross margin was {{N1}}.", [revenue], metricsOf, costMetrics)).toMatch(/no cost role/);
    // Not a margin claim: no check.
    expect(marginClaimProblem("Revenue was {{N1}}.", [revenue], metricsOf, costMetrics)).toBeUndefined();
    // RU and UZ words
    expect(marginClaimProblem("Маржа составила {{N1}}.", [revenue], metricsOf, costMetrics)).toBeDefined();
    expect(marginClaimProblem("Yalpi foyda {{N1}}.", [revenue], metricsOf, costMetrics)).toBeDefined();
  });

  it("V4: a cost column the user dropped (role none) is no cost role: the same margin claim now fails", async () => {
    const dropped = await run("2026-04");
    try {
      await dropped.w.run(sql`UPDATE profile_roles SET role = 'none' WHERE role IN ('unit_cost', 'cost_amount')`);
      const costMetrics = await costRoleMetrics(dropped.w, dropped.defs, dropped.catalog);
      expect(costMetrics.size).toBe(0);
      const margin = dropped.facts.find((f) => f.label.startsWith("gross_margin_")) as Fact;
      const metricsOf = (id: string) => new Set([dropped.facts.find((f) => f.id === id)?.metric_id ?? ""]);
      expect(marginClaimProblem("Gross margin was {{N1}}.", [margin.id], metricsOf, costMetrics)).toMatch(/no cost role/);
    } finally {
      dropped.w.close();
    }
  });

  it("V4: a table with no cost role has no cost metrics at all", async () => {
    const noCost: MetricDef[] = full.defs.filter((d) => d.id === "revenue");
    const costMetrics = await costRoleMetrics(full.w, noCost, full.catalog);
    expect(costMetrics.size).toBe(0);
  });
});
