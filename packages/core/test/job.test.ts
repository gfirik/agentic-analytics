// M7 acceptance: an end-to-end job on coffee-roaster-v1 with the scripted FakeModel produces a draft report whose
// text carries numbers only as fact placeholders, and every placeholder resolves to a computed fact.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DecideOutput } from "@agentic-analytics/agent";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { estimateObjectRequest } from "@agentic-analytics/models";
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
    // The answer key's driver (channel wholesale, 108% of the drop): the channel split is the most concentrated
    // explanation (−8,500 of 9,100 absolute movement); the hotel group's email gives the cause.
    expect(p1.drivers?.[0]?.label).toBe("“wholesale”");
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

  it("runs every stage once, skips the optional ones, renders report.html, and logs events", () => {
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
      "RENDER",
    ]);
    expect(out.htmlPath).toMatch(/report\.html$/);
    expect(readFileSync(out.htmlPath, "utf8")).toContain(out.report.findings[0]?.title.slice(0, 20) ?? "");
    expect(out.run.skipped).toEqual(["AWAIT_CONFIRM", "WEB_CONTEXT"]);
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

  it("small-model mode: a DECIDE request over the input budget is trimmed to fit, and its recommendations still verify (§8.1)", async () => {
    // The coffee fixture's small-model DECIDE request is about 5,700 estimated tokens; 3,500 takes most trimming steps.
    const budget = 3500;
    const run = async (inputTokens?: number) => {
      const m = coffeePlanner({ small: true });
      const r = await runJob(
        { dir: tempDir(), files, options: { ...options, smallModel: true, ...(inputTokens ? { budget: { inputTokens } } : {}) } },
        { model: m, embedder: hashEmbedder() },
      );
      const call = m.calls.find((c) => c.kind === "object" && c.prompt === "Propose the candidate actions.");
      return { r, size: estimateObjectRequest({ system: call?.system ?? "", prompt: call?.prompt ?? "", schema: DecideOutput }) };
    };
    const full = await run();
    const trimmed = await run(budget);
    expect(full.size).toBeGreaterThan(budget);
    expect(trimmed.size).toBeLessThanOrEqual(budget);
    // VERIFY passed (runJob only returns a verified report) and the recommendations survived it.
    expect(trimmed.r.report.recommendations.length).toBeGreaterThan(0);
    expect(trimmed.r.report.recommendations.map((x) => x.action)).toEqual(full.r.report.recommendations.map((x) => x.action));
    expect(checkReportIntegrity(trimmed.r.report)).toEqual([]);
    expect(trimmed.r.report.verification.numbers_mismatched).toBe(0);
    // Every recommendation cites facts that exist in the report (nothing the trimmed sheet left out went missing).
    const ids = new Set(trimmed.r.report.facts.map((f) => f.id));
    for (const rec of trimmed.r.report.recommendations)
      for (const id of [rec.impact.low, rec.impact.high, rec.check.threshold, ...rec.impact.inputs]) expect(ids.has(id), id).toBe(true);
  }, 180_000);

  it("small-model mode: a DECIDE request that can't fit the budget is not sent, and the report ships its findings without recommendations (§8.1)", async () => {
    const m = coffeePlanner({ small: true });
    const r = await runJob(
      { dir: tempDir(), files, options: { ...options, smallModel: true, budget: { inputTokens: 500 } } },
      { model: m, embedder: hashEmbedder() },
    );
    expect(m.calls.some((c) => c.prompt === "Propose the candidate actions.")).toBe(false);
    expect(r.report.recommendations).toEqual([]);
    expect(r.report.findings.length).toBeGreaterThan(0);
    expect(r.report.verification.numbers_mismatched).toBe(0);
    expect(checkReportIntegrity(r.report)).toEqual([]);
    expect(r.report.verification.claims_dropped).toContainEqual({
      claim: "(candidate actions)",
      reason: expect.stringMatching(/^the DECIDE request is about .*budget of 500; it was not sent$/),
    });
  }, 180_000);

  it("report.json carries evidence for what it cites: the cited table rows and the passage around each quote", () => {
    const ev = report.evidence ?? [];
    const cited = report.findings.flatMap((f) => f.claims.flatMap((c) => c.citations)).filter((c) => c.quote);
    expect(cited.length).toBeGreaterThan(0);
    for (const c of cited) {
      const e = ev.find((x) => x.source_id === c.source_id);
      expect(e?.kind, c.source_id).toBe("text");
      expect(e?.kind === "text" && e.text.includes(c.quote as string), c.source_id).toBe(true);
    }
    const rowCite = report.facts.flatMap((f) => f.citations).find((c) => c.rows?.length);
    const table = ev.find((x) => x.source_id === rowCite?.source_id);
    expect(table?.kind).toBe("table");
    if (table?.kind === "table") {
      expect(table.columns.map((c) => c.name)).toContain("Amount");
      expect(table.rows.map((r) => r.row)).toContain(rowCite?.rows?.[0]);
    }
  });
});

describe("runJob input names (security review)", () => {
  it("refuses a file name that is a path", async () => {
    for (const name of ["../escape.csv", "a/b.csv", "..", "c:\\x\\y.csv"]) {
      await expect(
        runJob(
          { dir: tempDir(), files: [{ name, bytes: new Uint8Array([97]) }], options },
          { model: coffeePlanner(), embedder: hashEmbedder() },
        ),
      ).rejects.toMatchObject({ code: "BAD_INPUT" });
    }
  });
});
