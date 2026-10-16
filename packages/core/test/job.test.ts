// M7 acceptance: an end-to-end job on coffee-roaster-v1 with the scripted FakeModel produces a draft report whose
// text carries numbers only as fact placeholders, and every placeholder resolves to a computed fact.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { checkReportIntegrity, findFreeNumerals, placeholders, type Report, validateReport } from "@agentic-analytics/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type JobOutcome, runJob } from "../src/index.ts";
import { coffeePlanner } from "../testing/coffee-planner.ts";

const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
const options = { today: "2026-07-01", currency: "USD" };
const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "aa-job-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

let out: JobOutcome;
let report: Report;
let model: ReturnType<typeof coffeePlanner>;
beforeAll(async () => {
  model = coffeePlanner();
  out = await runJob({ dir: tempDir(), jobId: "coffee", files, options }, { model, embedder: hashEmbedder() });
  report = out.report;
}, 180_000);

const texts = (r: Report): string[] => [
  r.summary.headline,
  ...r.findings.flatMap((f) => [f.title, ...f.claims.map((c) => c.text), ...f.confidence_reasons]),
  ...r.recommendations.flatMap((x) => [
    x.action,
    x.risk,
    x.impact.horizon,
    ...(x.not_advised ? [x.not_advised] : []),
    ...x.rationale.map((c) => c.text),
  ]),
  ...r.open_questions.flatMap((q) => [q.question, q.why_it_matters]),
  ...r.assumptions.map((a) => a.text),
  ...r.data_quality.map((d) => d.description),
];

describe("end-to-end coffee-roaster job with FakeModel (M7 acceptance)", () => {
  it("writes a schema-valid draft that passes the integrity checks", () => {
    const v = validateReport(JSON.parse(readFileSync(out.draftPath, "utf8")));
    expect(v.ok ? [] : v.issues).toEqual([]);
    expect(checkReportIntegrity(report)).toEqual([]);
  });

  it("has numbers only as placeholders, each resolving to a fact with a computation record", () => {
    const facts = new Map(report.facts.map((f) => [f.id, f]));
    for (const t of texts(report)) {
      expect(findFreeNumerals(t)).toEqual([]);
      for (const id of placeholders(t)) expect(facts.get(id)?.computation.kind).toMatch(/^(sql|function)$/);
    }
    expect(placeholders(texts(report).join(" ")).length).toBeGreaterThan(10);
  });

  it("finds the revenue drop (P1) and the refund-rate rise (P2), with the right evidence", () => {
    const titles = report.findings.map((f) => f.title);
    expect(titles).toContain("Revenue fell after March, driven by wholesale");
    expect(titles).toContain("Refund rate rose after the packaging supplier switch");
    const p1 = report.findings.find((f) => f.title.startsWith("Revenue fell")) as Report["findings"][number];
    const doc = p1.claims.find((c) => c.causal_grade === "document_supported");
    expect(doc?.citations[0]?.quote).toBe("After the new price list we are pausing our standing order while we compare suppliers.");
    // the observed claims are written by code with the golden numbers
    const facts = new Map(report.facts.map((f) => [f.id, f]));
    const observed = p1.claims[0];
    expect(observed?.causal_grade).toBe("observed");
    const values = observed?.facts.map((id) => facts.get(id)?.value ?? Number.NaN) ?? [];
    // March 44,100 → April 36,200: −7,900, −17.91%; June 37,000
    expect(values[0]).toBeCloseTo(44100, 6);
    expect(values[1]).toBeCloseTo(36200, 6);
    expect(values[2]).toBeCloseTo(-7900, 6);
    expect(values[3]).toBeCloseTo(-17.913832, 5);
    expect(p1.drivers?.[0]?.label).toBe("“Hotel Group LLC”");
  });

  it("drops what the planner got wrong and downgrades unsupported causal grades", () => {
    const v = report.verification;
    expect(v.claims_dropped).toContainEqual({ claim: "Wholesale also lost {{N99999}} in May.", reason: "unknown fact N99999" });
    expect(v.claims_dropped).toContainEqual({ claim: "Open a second shop", reason: "no finding supports it" });
    expect(v.claims_downgraded).toContainEqual({
      claim: "The drop was caused by the price increase.",
      from: "document_supported",
      to: "correlated",
      reason: "no source document cited",
    });
  });

  it("recommendations carry impact ranges computed in code", () => {
    const r1 = report.recommendations.find((r) => r.action.startsWith("Offer wholesale"));
    const facts = new Map(report.facts.map((f) => [f.id, f]));
    // |−8,500| × 0.5 × 0.94 = 3,995 … × 0.9 × 0.94 = 7,191 (wholesale change Mar → Apr by channel)
    expect(facts.get(r1?.impact.low ?? "")?.value).toBeCloseTo(3995, 6);
    expect(facts.get(r1?.impact.high ?? "")?.value).toBeCloseTo(7191, 6);
    expect(r1?.not_advised).toBe("Do not cut retail prices: retail revenue is growing.");
    expect(report.recommendations.every((r) => r.because.every((b) => report.findings.some((f) => f.id === b)))).toBe(true);
  });

  it("runs every stage once, skips the ones not built yet, and logs events", () => {
    expect(out.run.ran).toEqual([
      "INGEST",
      "PROFILE",
      "METRICS_DRAFT",
      "MEASURE",
      "DETECT",
      "DECOMPOSE",
      "INDEX_DOCS",
      "EXPLAIN",
      "DECIDE",
      "VERIFY",
    ]);
    expect(out.run.skipped).toEqual(["AWAIT_CONFIRM", "WEB_CONTEXT", "RENDER"]);
    // the extractor saw document text; the planner never did
    const planner = model.calls.filter((c) => c.role === "planner").map((c) => `${c.system ?? ""}${c.prompt}`);
    expect(planner.some((p) => p.includes("we are pausing our standing order while we compare suppliers"))).toBe(true); // only as an extract quote
    expect(planner.some((p) => p.includes("<document"))).toBe(false);
  });

  it("small-model mode: at most three findings and two recommendations, no tool loop", async () => {
    const m = coffeePlanner({ small: true });
    const r = await runJob({ dir: tempDir(), files, options: { ...options, smallModel: true } }, { model: m, embedder: hashEmbedder() });
    expect(r.report.findings.length).toBeLessThanOrEqual(3);
    expect(r.report.recommendations.length).toBeLessThanOrEqual(2);
    expect(m.calls.some((c) => c.kind === "tools")).toBe(false);
    // Each finding's title fits its own metric (the hotel story only on revenue findings).
    for (const f of r.report.findings) if (/retail/i.test(f.claims[0]?.text ?? "")) expect(f.title).not.toMatch(/hotel/i);
    expect(checkReportIntegrity(r.report)).toEqual([]);
  }, 180_000);
});
