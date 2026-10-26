// M15 PR 8, end to end on the committed margin dataset with the scripted baseline model: a whole job (every stage up to
// VERIFY) states the margin squeeze with its price, unit cost, volume and mix effects, every fact recomputes (V2), and the
// margin claim passes V4 because its facts are measured from the cost column.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJob } from "@agentic-analytics/core";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { baselineModel } from "../src/baseline.ts";

const DATASET = join(import.meta.dirname, "..", "..", "datasets", "wholesale-margin-v1");
const exp = parse(readFileSync(join(DATASET, "expectations.yaml"), "utf8")) as {
  today: string;
  currency: string;
  squeeze: { gross_margin: Record<string, number>; pvm_margin: { cost: number; price: number } };
};
const dirs: string[] = [];
let report: Awaited<ReturnType<typeof runJob>>["report"];
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "aa-margin-job-"));
  dirs.push(dir);
  const bytes = new Uint8Array(readFileSync(join(DATASET, "files", "invoice-lines.csv")));
  report = (
    await runJob(
      { dir, jobId: "margin", files: [{ name: "invoice-lines.csv", bytes }], options: { today: exp.today, currency: exp.currency } },
      { model: baselineModel(), embedder: hashEmbedder() },
    )
  ).report;
  expect(JSON.parse(readFileSync(join(dir, "report.json"), "utf8")).facts.length).toBe(report.facts.length);
}, 180_000);
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("wholesale-margin-v1 job (baseline model)", () => {
  it("verifies with 0 V2 mismatches and a fact of each margin function", () => {
    expect(report.verification.numbers_mismatched).toBe(0);
    expect(report.verification.numbers_checked).toBe(report.facts.length);
    const fns = new Set(report.facts.map((f) => f.computation.fn));
    for (const fn of ["gross_margin", "gross_margin_pct", "pvm_margin.v1"]) expect(fns.has(fn), fn).toBe(true);
  });

  it("states the squeeze: margin down 2,241.84 at flat revenue, split into the planted effects, and the claim survives V4", () => {
    const value = (label: string) => report.facts.find((f) => f.label === label)?.value;
    expect(value("gross_margin_2026-03")).toBeCloseTo(exp.squeeze.gross_margin["2026-03"] as number, 2);
    expect(value("pvm_margin.cost_2026-03")).toBeCloseTo(exp.squeeze.pvm_margin.cost, 3);
    expect(value("pvm_margin.price_2026-03")).toBeCloseTo(exp.squeeze.pvm_margin.price, 3);
    const claim = report.findings.flatMap((f) => f.claims).find((c) => c.text.includes("the change in margin split into"));
    expect(claim).toBeDefined();
    expect(report.verification.claims_dropped.filter((d) => d.claim.includes("margin"))).toEqual([]);
    expect(report.verification.definition_violations).toBe(0);
  });
});
