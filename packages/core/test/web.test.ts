// M8 acceptance on coffee-roaster-v1: a web-enabled run sends only sanitized queries, never fetches a private
// address, and labels everything from the web as external (sources, claims, benchmark facts).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateTerms } from "@agentic-analytics/agent";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { checkReportIntegrity, type Report } from "@agentic-analytics/schema";
import { Workspace } from "@agentic-analytics/store";
import { leaksPrivate } from "@agentic-analytics/web";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type JobOutcome, runJob } from "../src/index.ts";
import { coffeePlanner, coffeeWeb } from "../testing/coffee-planner.ts";

const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

let out: JobOutcome;
let report: Report;
let web: ReturnType<typeof coffeeWeb>;
let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aa-web-"));
  dirs.push(dir);
  web = coffeeWeb();
  out = await runJob(
    { dir, files, options: { today: "2026-07-01", currency: "USD", web: true } },
    { model: coffeePlanner({ web: true }), embedder: hashEmbedder(), web: { provider: web.provider, fetchPage: web.fetchPage } },
  );
  report = out.report;
}, 180_000);

describe("web-enabled run (M8 acceptance)", () => {
  it("runs WEB_CONTEXT and keeps the draft valid", () => {
    expect(out.run.ran).toContain("WEB_CONTEXT");
    expect(checkReportIntegrity(report)).toEqual([]);
  });

  it("no private value reaches the search provider", async () => {
    expect(web.queries).toEqual(["refunds — specialty coffee refund rate benchmark 2026"]);
    const ws = await Workspace.open(join(dir, "job.duckdb"));
    const terms = await privateTerms(ws);
    ws.close();
    expect(terms.names).toEqual(expect.arrayContaining(["Hotel Group LLC", "OOO Hotel Group"]));
    for (const q of web.queries) expect(leaksPrivate(q, terms)).toBe(false);
  });

  it("never fetches a private address the provider returned", () => {
    expect(web.fetched).toEqual(["https://coffee-benchmarks.example/refunds"]);
  });

  it("labels external sources, claims and facts", () => {
    const w = report.sources.find((s) => s.kind === "web");
    expect(w).toMatchObject({
      external: true,
      file: "https://coffee-benchmarks.example/refunds",
      locator: {
        url: "https://coffee-benchmarks.example/refunds",
        title: "Coffee refund benchmarks",
        fetched_at: "2026-07-01T09:00:00.000Z",
      },
    });
    const claim = report.findings.flatMap((f) => f.claims).find((c) => c.citations.some((x) => x.source_id === w?.id));
    expect(claim?.citations[0]?.quote).toBe("Specialty coffee roasters typically see refunds of 1–2% of sales.");
    const facts = new Map(report.facts.map((f) => [f.id, f]));
    const gap = facts.get(claim?.facts[0] ?? "");
    // June refund rate 3.4% vs the quoted 1–2%: 3.4 − 2 = 1.4 points above the range
    expect(gap?.value).toBeCloseTo(1.4, 9);
    const external = (gap?.computation.inputs ?? []).map((id) => facts.get(id)).filter((f) => f?.computation.fn === "external_quote");
    expect(external.map((f) => f?.value)).toEqual([1, 2]);
    expect(external.every((f) => f?.citations[0]?.source_id === w?.id)).toBe(true);
  });

  it("the hidden instruction on the page never reached the extractor", () => {
    const text = JSON.stringify(report);
    expect(text).not.toContain("Ignore previous instructions");
  });
});

describe("web lane off", () => {
  it("search_web answers that the lane is off, and nothing is fetched", async () => {
    const d = mkdtempSync(join(tmpdir(), "aa-web-"));
    dirs.push(d);
    const w = coffeeWeb();
    const r = await runJob(
      { dir: d, files, options: { today: "2026-07-01", currency: "USD" } },
      { model: coffeePlanner({ web: true }), embedder: hashEmbedder(), web: { provider: w.provider, fetchPage: w.fetchPage } },
    );
    expect(r.run.skipped).toContain("WEB_CONTEXT");
    expect(w.queries).toEqual([]);
    expect(r.report.sources.some((s) => s.kind === "web")).toBe(false);
  }, 180_000);
});
