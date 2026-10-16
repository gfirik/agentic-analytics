// M9 acceptance: seeded bad drafts are each dropped or downgraded correctly, and a V2 mismatch fails the job with
// a diagnostic. The drafts come from a real coffee-roaster job (scripted FakeModel), then get one defect each.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { type Catalog, loadCatalog } from "@agentic-analytics/metrics";
import type { GenerateObjectArgs, ModelClient } from "@agentic-analytics/models";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import type { Claim, MetricDef, Report } from "@agentic-analytics/schema";
import { sql, Workspace } from "@agentic-analytics/store";
import { verifyReport } from "@agentic-analytics/verify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJob } from "../src/index.ts";
import { coffeePlanner } from "../testing/coffee-planner.ts";

const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
const options = { today: "2026-07-01", currency: "USD" };
const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "aa-verify-"));
  dirs.push(d);
  return d;
};

let draft: Report;
let ws: Workspace;
let defs: MetricDef[];
let catalog: Catalog;
const judge = coffeePlanner();
beforeAll(async () => {
  const dir = tempDir();
  const out = await runJob({ dir, files, options }, { model: coffeePlanner(), embedder: hashEmbedder() });
  draft = out.draft;
  ws = await Workspace.open(join(dir, "job.duckdb"));
  const m = await ws.one<{ output: string }>(sql`SELECT output::VARCHAR AS output FROM job_stages WHERE stage = 'METRICS_DRAFT'`);
  defs = (JSON.parse(m?.output ?? "{}") as { defs: MetricDef[] }).defs;
  catalog = await loadCatalog(ws);
}, 180_000);
afterAll(() => {
  ws.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const verify = (r: Report) => verifyReport(r, { ws, defs, catalog, grain: "month", periodEnd: "2026-06-30", judge });
const clone = (r: Report): Report => JSON.parse(JSON.stringify(r)) as Report;
const claim = (text: string, facts: string[], extra: Partial<Claim> = {}): Claim => ({
  text,
  facts,
  citations: [],
  causal_grade: "correlated",
  verified: false,
  ...extra,
});
const f1 = (r: Report) => r.findings[0] as Report["findings"][number];
const reasonFor = (r: Report, text: string) => r.verification.claims_dropped.find((d) => d.claim === text)?.reason;

describe("seeded bad drafts (M9 acceptance)", () => {
  it("the clean draft verifies: every fact recomputes, headline facts re-derive, nothing new is dropped", async () => {
    const r = await verify(clone(draft));
    expect(r.report.verification.numbers_checked).toBe(draft.facts.length);
    expect(r.report.verification.numbers_mismatched).toBe(0);
    expect(r.report.verification.rederived_metrics).toBeGreaterThan(0);
    expect(r.report.facts.every((f) => f.verified)).toBe(true);
    expect(r.report.findings.length).toBe(draft.findings.length);
    expect(r.checks.filter((c) => c.check === "V2").every((c) => c.passed)).toBe(true);
  });

  it("a free numeral is dropped (V1)", async () => {
    const d = clone(draft);
    f1(d).claims.push(claim("Revenue fell by 7,900 dollars in April.", []));
    const r = await verify(d);
    expect(reasonFor(r.report, "Revenue fell by 7,900 dollars in April.")).toMatch(/^V1: free numeral/);
    expect(f1(r.report).claims.some((c) => c.text.includes("7,900"))).toBe(false);
  });

  it("a wrong definition is dropped (V4): revenue facts presented as orders", async () => {
    const d = clone(draft);
    const [before, after] = f1(d).claims[0]?.facts ?? [];
    const text = `Orders went from {{${before}}} to {{${after}}}.`;
    f1(d).claims.push(claim(text, [before as string, after as string], { causal_grade: "observed" }));
    const r = await verify(d);
    expect(reasonFor(r.report, text)).toMatch(/^V4: the claim names Orders but fact N\d+ measures Revenue/);
    expect(r.report.verification.definition_violations).toBe(1);
  });

  it("unsupported citations are dropped (V5): a quote not in the source, and a quote the judge rejects", async () => {
    const d = clone(draft);
    const doc = d.sources.find((s) => s.file === "email-0412.eml")?.id as string;
    // The price list is one source per page: take the page a real claim quotes.
    const price = d.findings
      .flatMap((f) => f.claims)
      .flatMap((c) => c.citations)
      .find((c) => c.quote?.startsWith("Wholesale prices"))?.source_id as string;
    const fake = claim("The hotel paused its order.", [], {
      citations: [{ source_id: doc, quote: "We are cancelling every order forever." }],
      causal_grade: "document_supported",
    });
    const offTopic = claim("The hotel closed its kitchen for renovation in April.", [], {
      citations: [{ source_id: price, quote: "Wholesale prices increase 12% from 15 March 2026." }],
      causal_grade: "document_supported",
    });
    f1(d).claims.push(fake, offTopic);
    const r = await verify(d);
    expect(reasonFor(r.report, fake.text)).toBe(`V5: the quote is not in source ${doc}`);
    expect(reasonFor(r.report, offTopic.text)).toBe("V5: the judge found the cited sources don't support the claim");
    expect(r.report.verification.citations_unsupported).toBe(2);
  });

  it("causal overreach is reworded to correlational (V6), and an undocumented strong grade is downgraded", async () => {
    const d = clone(draft);
    const text = "Revenue fell because of the new packaging supplier.";
    f1(d).claims.push(claim(text, [], { causal_grade: "correlated" }));
    const r = await verify(d);
    const kept = f1(r.report).claims.map((c) => c.text);
    expect(kept).toContain("Revenue fell around the time of the new packaging supplier.");
    expect(kept).not.toContain(text);
    expect(r.report.verification.claims_downgraded).toContainEqual(
      expect.objectContaining({ claim: text, to: "correlated", reason: expect.stringMatching(/^V6: causal wording/) }),
    );
  });

  it("an ungrounded recommendation is dropped (V7), and so is one whose check date isn't after the data", async () => {
    const d = clone(draft);
    const r1 = d.recommendations[0] as Report["recommendations"][number];
    d.recommendations.push({ ...r1, id: "R8", action: "Open a kiosk at the airport", because: ["F99"] });
    d.recommendations.push({ ...r1, id: "R9", action: "Review prices last spring", check: { ...r1.check, by: "2026-03-01" } });
    const r = await verify(d);
    expect(reasonFor(r.report, "Open a kiosk at the airport")).toBe("V7: no verified finding supports it");
    expect(reasonFor(r.report, "Review prices last spring")).toBe("V7: its check date 2026-03-01 is not after the data (2026-06-30)");
    expect(r.report.recommendations.map((x) => x.id)).toEqual(draft.recommendations.map((x) => x.id));
  });

  it("a finding left with no claims is dropped, and recommendations that relied on it go with it (cascade)", async () => {
    const d = clone(draft);
    const refundFinding = d.findings.find((f) => f.title.startsWith("Refund rate")) as Report["findings"][number];
    refundFinding.claims = [claim("Refunds rose by 2 points.", [])];
    const r = await verify(d);
    expect(r.report.findings.some((f) => f.id === refundFinding.id)).toBe(false);
    expect(r.report.recommendations.some((x) => x.because.includes(refundFinding.id))).toBe(false);
    expect(reasonFor(r.report, refundFinding.title)).toBe(`V7: finding ${refundFinding.id} has no verified claim left`);
  });

  it("a V2 mismatch (a tampered fact) fails verification instead of shipping", async () => {
    const d = clone(draft);
    const f = d.facts.find((x) => x.computation.kind === "sql") as Report["facts"][number];
    f.value += 1;
    await expect(verify(d)).rejects.toMatchObject({ code: "RECOMPUTE_MISMATCH" });
  });
});

describe("a V2 mismatch fails the job with a diagnostic (M9 acceptance)", () => {
  it("VERIFY fails loudly, writes diagnostics.json and no report.json", async () => {
    const dir = tempDir();
    const planner = coffeePlanner();
    // The judge is unavailable the first time, so the job stops at VERIFY with a draft on disk.
    let down = true;
    const flaky: ModelClient = {
      generateObject<T>(a: GenerateObjectArgs<T>) {
        if (down && a.role === "judge") return Promise.reject(new Error("judge unavailable"));
        return planner.generateObject(a);
      },
      generateWithTools: (a) => planner.generateWithTools(a),
      embed: (t) => planner.embed(t),
    };
    await expect(runJob({ dir, files, options }, { model: flaky, embedder: hashEmbedder() })).rejects.toMatchObject({ stage: "VERIFY" });
    // Someone (or a bug) changes a number in the draft between DECIDE and VERIFY.
    const path = join(dir, "report.draft.json");
    const tampered = JSON.parse(readFileSync(path, "utf8")) as Report;
    const fact = tampered.facts.find((x) => x.computation.kind === "sql") as Report["facts"][number];
    fact.value = fact.value * 2 + 1;
    writeFileSync(path, JSON.stringify(tampered));
    down = false;
    await expect(runJob({ dir }, { model: flaky, embedder: hashEmbedder() })).rejects.toMatchObject({
      code: "STAGE_FAILED",
      stage: "VERIFY",
    });
    const diag = JSON.parse(readFileSync(join(dir, "diagnostics.json"), "utf8")) as {
      code: string;
      detail: { mismatched: { fact: string }[] };
    };
    expect(diag.code).toBe("RECOMPUTE_MISMATCH");
    expect(diag.detail.mismatched.map((m) => m.fact)).toEqual([fact.id]);
    expect(existsSync(join(dir, "report.json"))).toBe(false);
  }, 180_000);
});
