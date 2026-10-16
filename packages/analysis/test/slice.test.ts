// The agent tools' analysis entry points on coffee-roaster-v1: drill-down (contribution.v1 on a slice) and
// scenario impact over existing facts. New facts continue after the stored ones and are persisted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingest } from "@agentic-analytics/ingest";
import { type Catalog, fallbackMetrics, loadCatalog, validateMetrics } from "@agentic-analytics/metrics";
import { profileJob } from "@agentic-analytics/profile";
import type { MetricDef } from "@agentic-analytics/schema";
import { Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeJob, drillDown, loadAnalysis, nextFactNumber, readFacts, scenarioFacts } from "../src/index.ts";

const dir = join(import.meta.dirname, "..", "..", "..", "evals/datasets/coffee-roaster-v1/files");
const range = { from: "2026-01", to: "2026-06", grain: "month" as const };
let ws: Workspace;
let defs: MetricDef[];
let catalog: Catalog;
let analysisFacts: number;

beforeAll(async () => {
  ws = await Workspace.open();
  const files = ["sales-2026.xlsx", "price-list.pdf", "email-0412.eml", "ops-notes.docx"].map((f) => ({
    name: f,
    bytes: new Uint8Array(readFileSync(join(dir, f))),
  }));
  const summary = await profileJob(ws, await ingest(files), { today: "2026-07-01" });
  catalog = await loadCatalog(ws);
  defs = validateMetrics(fallbackMetrics(summary), catalog, { defaultCurrency: "USD" }).accepted;
  analysisFacts = (await analyzeJob(ws, defs, catalog, range)).facts.length;
}, 120_000);
afterAll(() => ws.close());

describe("readFacts / loadAnalysis round-trip the persisted analysis", () => {
  it("every analysis fact, insight and decomposition comes back", async () => {
    expect((await readFacts(ws)).length).toBe(analysisFacts);
    expect(await nextFactNumber(ws)).toBe(analysisFacts + 1);
    const a = await loadAnalysis(ws);
    expect(a.insights.length).toBeGreaterThan(0);
    expect(a.insights[0]?.id).toBe("I1");
  });
});

describe("drill_down: contribution.v1 on one slice", () => {
  it("revenue April vs March by channel: wholesale −8,500 of −7,900 (107.59%)", async () => {
    const before = await nextFactNumber(ws);
    const r = await drillDown(ws, defs, catalog, { metric: "revenue", period: "2026-04", dimension: "channel", range });
    expect([r.before, r.after]).toEqual(["2026-03", "2026-04"]);
    const v = (id: string | undefined) => r.newFacts.find((f) => f.id === id)?.value;
    expect(v(r.facts.total)).toBeCloseTo(-7900, 6);
    expect(v(r.facts["change:wholesale"])).toBeCloseTo(-8500, 6);
    expect(v(r.facts["share:wholesale"])).toBeCloseTo(107.594937, 5);
    // ids continue after the stored facts, and the new facts are stored
    expect(r.newFacts[0]?.id).toBe(`N${before}`);
    expect(await nextFactNumber(ws)).toBe(before + r.newFacts.length);
    // measured member points carry SQL with cited rows, like the analysis' own facts
    expect(r.newFacts.some((f) => f.computation.kind === "sql" && f.citations.length > 0)).toBe(true);
  });

  it("refuses slices the template can't add up", async () => {
    await expect(
      drillDown(ws, defs, catalog, { metric: "refund_rate", period: "2026-04", dimension: "customer", range }),
    ).rejects.toMatchObject({
      code: "BAD_SLICE",
    });
    await expect(drillDown(ws, defs, catalog, { metric: "revenue", period: "2026-04", dimension: "status", range })).rejects.toMatchObject({
      code: "BAD_SLICE",
    });
    await expect(drillDown(ws, defs, catalog, { metric: "revenue", period: "2026-01", dimension: "channel", range })).rejects.toMatchObject(
      {
        code: "BAD_SLICE",
      },
    );
  });
});

describe("propose_scenario: impact.v1 over existing facts", () => {
  it("recover 50–90% of the lost wholesale revenue net of a 6% discount: 3,995 … 7,191", async () => {
    const d = await drillDown(ws, defs, catalog, { metric: "revenue", period: "2026-04", dimension: "channel", range });
    const lost = d.facts["change:wholesale"] as string;
    const r = await scenarioFacts(ws, defs, catalog, "month", { type: "recover_share", lost, low: 0.5, high: 0.9, discount: 0.06 });
    const v = (id: string) => r.newFacts.find((f) => f.id === id)?.value;
    // |−8,500| × 0.5 × 0.94 = 3,995; × 0.9 × 0.94 = 7,191
    expect(v(r.low)).toBeCloseTo(3995, 6);
    expect(v(r.high)).toBeCloseTo(7191, 6);
    const low = r.newFacts.find((f) => f.id === r.low);
    expect(low?.computation.inputs).toContain(lost);
    expect(low?.currency).toBe("USD");
    expect(r.params.map(v)).toEqual([50, 90, 6]);
  });

  it("unknown fact ids and out-of-range parameters are typed errors", async () => {
    await expect(
      scenarioFacts(ws, defs, catalog, "month", { type: "price_change", revenue: "N99999", low: 0, high: 0.1 }),
    ).rejects.toMatchObject({
      code: "UNKNOWN_FACT",
    });
    await expect(
      scenarioFacts(ws, defs, catalog, "month", { type: "price_change", revenue: "N1", low: 0, high: 0.5 }),
    ).rejects.toMatchObject({
      code: "PARAM_OUT_OF_RANGE",
    });
  });
});
