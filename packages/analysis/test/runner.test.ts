// M5 acceptance on coffee-roaster-v1: the runner reproduces the golden outputs exactly, and every number it
// produces is a fact with a computation record and citations (AGENTS.md §2.1–2.2).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingest } from "@agentic-analytics/ingest";
import { fallbackMetrics, loadCatalog, validateMetrics } from "@agentic-analytics/metrics";
import { profileJob } from "@agentic-analytics/profile";
import type { Fact } from "@agentic-analytics/schema";
import { sql, Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AnalysisResult, analyzeJob } from "../src/index.ts";

const dir = join(import.meta.dirname, "..", "..", "..", "evals/datasets/coffee-roaster-v1/files");
let ws: Workspace;
let result: AnalysisResult;

beforeAll(async () => {
  ws = await Workspace.open();
  const files = ["sales-2026.xlsx", "price-list.pdf", "email-0412.eml", "ops-notes.docx"].map((f) => ({
    name: f,
    bytes: new Uint8Array(readFileSync(join(dir, f))),
  }));
  const summary = await profileJob(ws, await ingest(files), { today: "2026-07-01" });
  const catalog = await loadCatalog(ws);
  const defs = validateMetrics(fallbackMetrics(summary), catalog, { defaultCurrency: "USD" }).accepted;
  result = await analyzeJob(ws, defs, catalog, { from: "2026-01", to: "2026-06" });
}, 120_000);
afterAll(() => ws.close());

const fact = (id: string | undefined): Fact => {
  const f = result.facts.find((x) => x.id === id);
  if (!f) throw new Error(`no fact ${id}`);
  return f;
};
const insight = (template: string, metric: string, period?: string) =>
  result.insights.find((i) => i.template === template && i.metric === metric && !i.member && (!period || i.period === period));

describe("M5 golden outputs on coffee-roaster-v1", () => {
  it("revenue Apr vs Mar −17.9% (trend break after March)", () => {
    const b = insight("trend_break.v1", "revenue", "2026-04");
    expect(b?.material).toBe(true);
    // 36,200 / 44,100 − 1 = −0.1791383 → −17.9%
    expect(fact(b?.facts.change_pct).value).toBeCloseTo(-17.913832, 5);
    expect(fact(b?.facts.before).value).toBeCloseTo(44100, 6);
    expect(fact(b?.facts.after).value).toBeCloseTo(36200, 6);
  });

  it("wholesale accounts for 108% of the April drop", () => {
    const b = insight("trend_break.v1", "revenue", "2026-04");
    const byChannel = result.decompositions.find((d) => d.insight === b?.id && d.method === "contribution.v1" && d.dimension === "channel");
    // wholesale −8,500 of a −7,900 total → 107.59%
    expect(fact(byChannel?.facts["share:wholesale"]).value).toBeCloseTo(107.594937, 5);
    expect(fact(byChannel?.facts["change:wholesale"]).value).toBeCloseTo(-8500, 6);
    expect(fact(byChannel?.facts.total).value).toBeCloseTo(-7900, 6);
  });

  it("refund rate 1.2% → 3.4%", () => {
    const b = insight("trend_break.v1", "refund_rate");
    expect(fact(b?.facts.before).value).toBeCloseTo(1.2, 9); // March: 529.20 / 44,100 × 100
    expect(fact(b?.facts.latest).value).toBeCloseTo(3.4, 9); // June: 1,258 / 37,000 × 100
    expect(fact(b?.facts.change_since).value).toBeCloseTo(2.2, 9);
  });

  it("ranks the revenue break first for EXPLAIN", () => {
    const first = result.insights.find((i) => i.id === result.top[0]);
    expect([first?.metric, first?.period].join(" ")).toMatch(/revenue 2026-04/);
    expect(result.top.length).toBeGreaterThanOrEqual(3);
    expect(result.top.length).toBeLessThanOrEqual(7);
  });

  it("PVM by product adds up exactly to the April revenue change", () => {
    const b = insight("trend_break.v1", "revenue", "2026-04");
    const p = result.decompositions.find((d) => d.insight === b?.id && d.method === "pvm.v1");
    expect(p?.dimension).toBe("product");
    const v = (k: string) => fact(p?.facts[k]).value;
    expect(v("volume") + v("mix") + v("price") + v("new") + v("lost")).toBeCloseTo(-7900, 6);
    expect(v("total")).toBeCloseTo(-7900, 6);
  });
});

describe("every number is a fact with provenance", () => {
  it("measured facts carry SQL with parameters and cite their input rows", () => {
    const measured = result.facts.filter((f) => f.computation.kind === "sql");
    expect(measured.length).toBeGreaterThan(5);
    for (const f of measured) {
      expect(f.computation.sql, f.label).toContain('FROM "t_t1"');
      // A fact cites rows exactly when it has input rows; a member with no rows in a period is a 0 that cites nothing.
      const inputRows = Number(f.computation.params?.input_rows ?? 0);
      expect(f.citations.length > 0, f.label).toBe(inputRows > 0);
      if (inputRows === 0) expect(f.value, f.label).toBe(0);
      expect(f.citations.every((c) => c.source_id === "T1" && (c.rows?.length ?? 0) > 0 && (c.rows?.length ?? 0) <= 50)).toBe(true);
    }
    // revenue for March: 1,050 paid orders → 50 cited rows, total kept in params
    const march = result.facts.find((f) => f.label === "revenue_2026-03");
    expect(march?.computation.params?.input_rows).toBe(1050);
  });

  it("derived facts reference existing facts only, and insights reference existing facts", () => {
    const ids = new Set(result.facts.map((f) => f.id));
    for (const f of result.facts.filter((x) => x.computation.kind === "function")) {
      expect(f.computation.fn, f.label).toBeTruthy();
      for (const input of f.computation.inputs ?? []) expect(ids.has(input), `${f.label} → ${input}`).toBe(true);
    }
    for (const i of [...result.insights, ...result.decompositions]) for (const id of Object.values(i.facts)) expect(ids.has(id)).toBe(true);
  });

  it("persists facts, insights and decompositions in the workspace", async () => {
    expect(await ws.one(sql`SELECT count(*) AS n FROM facts`)).toEqual({ n: result.facts.length });
    expect(await ws.one(sql`SELECT count(*) AS n FROM insights`)).toEqual({ n: result.insights.length });
    expect(await ws.one(sql`SELECT count(*) AS n FROM decompositions`)).toEqual({ n: result.decompositions.length });
  });

  it("the March revenue rise (distractor D1) is not a finding", () => {
    expect(result.insights.some((i) => i.metric === "revenue" && !i.member && i.period === "2026-03")).toBe(false);
  });
});
