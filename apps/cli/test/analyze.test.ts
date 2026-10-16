// M10: `aa analyze` through the job manager, `aa ask`, `aa explain` and `aa jobs ls`, with the scripted planner.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobManager } from "@agentic-analytics/core";
import { coffeePlanner } from "@agentic-analytics/core/testing";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import type { ReviewChoice } from "@agentic-analytics/metrics";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import type { Report } from "@agentic-analytics/schema";
import { afterAll, describe, expect, it } from "vitest";
import { analyzeCommand } from "../src/analyze.ts";
import { askCommand, explainCommand, jobsList } from "../src/followup.ts";

const tmp = mkdtempSync(join(tmpdir(), "aa-analyze-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
const manager = new JobManager({
  root: join(tmp, "jobs"),
  model: coffeePlanner(),
  deps: () => ({ model: coffeePlanner(), embedder: hashEmbedder() }),
});
const options = { today: "2026-07-01", currency: "USD" };

describe("aa analyze", () => {
  let jobId: string;

  it("--yes: live stage view, summary, and the report copied to <out>/agentic-analytics/", async () => {
    const lines: string[] = [];
    const r = await analyzeCommand({ files, options, out: join(tmp, "out"), jobId: "cli-yes" }, { manager, print: (l) => lines.push(l) });
    expect(r.code).toBe(0);
    jobId = r.jobId;
    expect(lines).toContain("▸ VERIFY");
    expect(lines.some((l) => /^✓ RENDER \(\d+ ms\)$/.test(l))).toBe(true);
    expect(lines.join("\n")).not.toMatch(/\{\{N\d+\}\}/);
    expect(lines).toContain("Note: some metric definitions were assumed, not confirmed. Check them in the report's Metrics section.");
    expect(existsSync(join(tmp, "out", "agentic-analytics", "report.html"))).toBe(true);
    const report = JSON.parse(readFileSync(join(tmp, "out", "agentic-analytics", "report.json"), "utf8")) as Report;
    expect(report.metrics.every((m) => m.status === "assumed")).toBe(true);
  }, 180_000);

  it("interactive review: a bad edit is refused and reviewed again; dropped metrics leave the report", async () => {
    const lines: string[] = [];
    const answers: ReviewChoice[] = [];
    let round = 0;
    const review = {
      show: (l: string) => lines.push(l),
      async choose(q: string): Promise<ReviewChoice> {
        // Round 1: edit revenue badly. Round 2: accept revenue, drop "orders", accept the rest.
        const c: ReviewChoice = round === 0 && q === "Metric revenue?" ? "edit" : round === 1 && q === "Metric orders?" ? "drop" : "accept";
        answers.push(c);
        return c;
      },
      async edit() {
        round++;
        return "id: revenue\nlabel: Revenue\nkind: sum\nvalue_column: no_such_column";
      },
    };
    const r = await analyzeCommand(
      { files, options, out: join(tmp, "out2"), jobId: "cli-review" },
      { manager, print: (l) => lines.push(l), review },
    );
    expect(lines.some((l) => /^(Not accepted|That edit did not parse)/.test(l))).toBe(true);
    expect(r.code).toBe(0);
    const report = JSON.parse(readFileSync(r.reportPath as string, "utf8")) as Report;
    expect(report.metrics.map((m) => m.id)).not.toContain("orders");
    expect(report.metrics.every((m) => m.status === "confirmed")).toBe(true);
    expect(answers).toContain("drop");
  }, 180_000);

  it("aa ask, aa explain and aa jobs ls print from the report's facts", async () => {
    const lines: string[] = [];
    expect(await askCommand(manager, jobId, "Why did revenue drop?", (l) => lines.push(l))).toBe(0);
    expect(lines[0]).toMatch(/^• Revenue/);
    expect(lines.join("\n")).not.toMatch(/\{\{N\d+\}\}/);
    expect(lines.at(-1)).toBe("(1 statement(s) failed verification and were left out)");
    const report = await manager.report(jobId);
    const fact = report.facts.find((f) => f.computation.kind === "sql" && f.citations.some((c) => c.rows?.length));
    const out: string[] = [];
    expect(await explainCommand(manager, jobId, fact?.id as string, (l) => out.push(l))).toBe(0);
    expect(out[0]).toMatch(new RegExp(`^${fact?.id} = `));
    expect(out).toContain("sql:");
    expect(out.some((l) => l.startsWith("input rows from "))).toBe(true);
    const ls: string[] = [];
    await jobsList(manager, (l) => ls.push(l));
    expect(ls.map((l) => l.split(" ")[0])).toEqual(["cli-review", "cli-yes"]);
  }, 60_000);
});
