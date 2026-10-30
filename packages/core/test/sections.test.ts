// M15 PR 10 end to end on coffee-roaster-v1 (scripted FakeModel): the scorecard, concentration and "Analyses not run" in
// report.json and report.html (report-schema §5b, §6), built by code; V2 fails a tampered material flag and V1 drops a
// not-run reason with a numeral (agent-and-verifier §7); the business model's assumption names the findings it affects.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { type Catalog, loadCatalog } from "@agentic-analytics/metrics";
import { renderReportHtml } from "@agentic-analytics/report";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { checkReportIntegrity, type Fact, type MetricDef, type Report } from "@agentic-analytics/schema";
import { sql, Workspace } from "@agentic-analytics/store";
import { verifyReport } from "@agentic-analytics/verify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type JobOutcome, runJob } from "../src/index.ts";
import { coffeePlanner } from "../testing/coffee-planner.ts";

const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
let dir: string;
let out: JobOutcome;
let ws: Workspace;
let defs: MetricDef[];
let catalog: Catalog;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aa-sections-"));
  out = await runJob(
    { dir, files, options: { today: "2026-07-01", currency: "USD" } },
    { model: coffeePlanner(), embedder: hashEmbedder() },
  );
  ws = await Workspace.open(join(dir, "job.duckdb"));
  const m = await ws.one<{ output: string }>(sql`SELECT output::VARCHAR AS output FROM job_stages WHERE stage = 'METRICS_DRAFT'`);
  defs = (JSON.parse(m?.output ?? "{}") as { defs: MetricDef[] }).defs;
  catalog = await loadCatalog(ws);
}, 180_000);
afterAll(() => {
  ws.close();
  rmSync(dir, { recursive: true, force: true });
});

const report = () => out.report;
const fact = (id: string | undefined): Fact => {
  const f = report().facts.find((x) => x.id === id);
  if (!f) throw new Error(`no fact ${id}`);
  return f;
};
const clone = (r: Report): Report => JSON.parse(JSON.stringify(r)) as Report;
const verify = (r: Report) => verifyReport(r, { ws, defs, catalog, grain: "month", periodEnd: "2026-06-30", judge: coffeePlanner() });
const section = (html: string, id: string) => new RegExp(`<section aria-labelledby="${id}">.*?</section>`, "s").exec(html)?.[0];

describe("the scorecard in report.json (analysis-library §12)", () => {
  it("has the spec's hand-computed rows for June 2026, every cell a verified fact", () => {
    const sc = report().scorecard;
    expect(sc?.period).toBe("2026-06");
    const row = (id: string) => sc?.rows.find((r) => r.metric_id === id);
    // revenue 37,000, +1,200 vs May, band 3,113.46: not material; refund rate +0.5 pp against a band of 0.44478: material.
    expect(fact(row("revenue")?.value).value).toBeCloseTo(37000, 6);
    expect(row("revenue")?.material).toBe(false);
    expect(fact(row("refund_rate")?.materiality_inputs?.band).value).toBeCloseTo(0.44478, 9);
    expect(row("refund_rate")?.material).toBe(true);
    for (const r of sc?.rows ?? []) expect(fact(r.value).verified).toBe(true);
    expect(checkReportIntegrity(report())).toEqual([]);
  });

  it("is built by code: small-model mode gives the same sections (analyst-grade §3.5)", async () => {
    const small = mkdtempSync(join(tmpdir(), "aa-sections-small-"));
    try {
      const s = await runJob(
        { dir: small, files, options: { today: "2026-07-01", currency: "USD", smallModel: true } },
        { model: coffeePlanner(), embedder: hashEmbedder() },
      );
      const cells = (r: Report) => (r.scorecard?.rows ?? []).map((x) => [x.metric_id, fact(x.value).label, x.material]);
      expect(s.report.scorecard?.rows.map((x) => [x.metric_id, s.report.facts.find((f) => f.id === x.value)?.label, x.material])).toEqual(
        cells(report()),
      );
      expect(s.report.analyses_not_run).toEqual(report().analyses_not_run);
    } finally {
      rmSync(small, { recursive: true, force: true });
    }
  }, 180_000);
});

describe("Analyses not run and concentration in report.json (§11, §13)", () => {
  it("lists margin and margin PVM as not run (no cost column), each with a reason and no number", () => {
    const list = report().analyses_not_run ?? [];
    expect(list.map((n) => `${n.analysis}/${n.reason_code}`)).toEqual(
      expect.arrayContaining(["gross_margin/no_cost_role", "pvm_margin.v1/no_cost_role", "yoy/too_few_periods"]),
    );
    expect(report().facts.some((f) => f.label.startsWith("gross_margin"))).toBe(false);
  });

  it("carries the Pareto and concentration facts of each pack dimension", () => {
    const conc = report().concentration ?? [];
    expect(conc.map((c) => c.dimension)).toEqual(expect.arrayContaining(["customer"]));
    const customer = conc.find((c) => c.dimension === "customer");
    expect(fact(customer?.pareto[0]?.members).label).toBe("pareto.members.customer_ttm");
    expect(fact(customer?.shares.find((s) => s.period === "ttm")?.hhi).label).toBe("hhi.customer_ttm");
  });
});

describe("the verifier on the sections (agent-and-verifier §7)", () => {
  it("V2: a tampered material flag fails the job as a mismatch", async () => {
    const d = clone(out.draft);
    const row = d.scorecard?.rows.find((r) => r.metric_id === "refund_rate");
    if (!row) throw new Error("no refund rate row");
    row.material = false;
    await expect(verify(d)).rejects.toMatchObject({ code: "RECOMPUTE_MISMATCH" });
  });

  it("V2: a wrong band fact is reported as the fact mismatch, not as the flag it feeds", async () => {
    const d = clone(out.draft);
    const band = d.scorecard?.rows.find((r) => r.metric_id === "refund_rate")?.materiality_inputs?.band;
    const f = d.facts.find((x) => x.id === band);
    if (!band || !f) throw new Error("no refund rate band");
    // A band of 1.44478 makes the +0.5 pp change not material, so the stored flag (true) no longer recomputes either.
    f.value += 1;
    await ws.run(sql`UPDATE facts SET value = value + 1 WHERE id = ${band}`);
    try {
      await expect(verify(d)).rejects.toMatchObject({
        code: "RECOMPUTE_MISMATCH",
        message: expect.stringMatching(/fact\(s\) don't recompute/),
        diagnostic: { mismatched: [expect.objectContaining({ fact: band })] },
      });
    } finally {
      await ws.run(sql`UPDATE facts SET value = value - 1 WHERE id = ${band}`);
    }
  });

  it("V1: a not-run reason with a numeral is dropped and listed", async () => {
    const d = clone(out.draft);
    d.analyses_not_run = [
      ...(d.analyses_not_run ?? []),
      { analysis: "yoy", reason_code: "too_few_periods", reason: "Needs 13 months.", needs: [] },
    ];
    const r = await verify(d);
    expect(r.report.analyses_not_run?.some((n) => n.reason === "Needs 13 months.")).toBe(false);
    expect(r.report.verification.claims_dropped.find((x) => x.claim === "Needs 13 months.")?.reason).toMatch(/^V1: /);
    expect(r.checks.some((c) => c.check === "V1" && !c.passed && /not-run yoy/.test(c.detail ?? ""))).toBe(true);
  });
});

describe("the business model's assumption (semantics §4)", () => {
  it("is named by exactly the findings it affects", () => {
    const r = report();
    const id = r.business_model?.assumption;
    const a = r.assumptions.find((x) => x.id === id);
    expect(a).toBeDefined();
    expect(r.findings.filter((f) => f.assumptions.includes(id ?? "")).map((f) => f.id)).toEqual(a?.affects);
  });
});

describe("report.html (report-schema §6)", () => {
  const html = () => renderReportHtml(report());

  it("orders the sections: scorecard before findings, concentration after recommendations, not-run before assumptions", () => {
    const at = (id: string) => html().indexOf(`aria-labelledby="${id}"`);
    expect(at("scorecard")).toBeGreaterThan(0);
    expect(at("scorecard")).toBeLessThan(at("findings"));
    expect(at("concentration")).toBeGreaterThan(at("recs"));
    expect(at("not-run")).toBeLessThan(at("assumptions"));
  });

  it("renders the scorecard and the not-run list as in the snapshot", () => {
    expect(section(html(), "scorecard")).toMatchSnapshot();
    expect(section(html(), "not-run")).toMatchSnapshot();
  });
});
