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
import { ReviewEndedError } from "../src/prompt.ts";

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
    // --yes keeps the proposed roles as assumptions (semantics §5), each read by a metric with its own assumption
    expect(report.roles?.length).toBeGreaterThan(0);
    expect(report.roles?.every((r) => r.status === "assumed")).toBe(true);
    expect(report.roles?.find((r) => r.table_id === "T1" && r.column === "amount")?.assumption).toBeDefined();
  }, 180_000);

  it("interactive review: roles and metrics on one screen; accepting everything confirms both", async () => {
    const lines: string[] = [];
    const asked: string[] = [];
    const review = {
      show: (l: string) => lines.push(l),
      async choose(q: string): Promise<ReviewChoice> {
        asked.push(q);
        return "accept";
      },
      edit: async () => "",
    };
    const r = await analyzeCommand(
      { files, options, out: join(tmp, "out-roles"), jobId: "cli-roles" },
      { manager, print: (l) => lines.push(l), review },
    );
    expect(r.code).toBe(0);
    const text = lines.join("\n");
    // the screen lists the roles with their evidence, the table kinds and the business model before the first metric
    expect(lines).toContain('  t_t1.Amount → amount [assumed] (header is "amount"; type currency fits)');
    expect(lines).toContain("  t_t1: sales_lines (from transaction_date, amount, customer, product, order_id, channel)");
    expect(text).toMatch(/Business model: \w+ \[assumed\]/);
    expect(text.indexOf("Column roles")).toBeLessThan(text.indexOf("Revenue = sum of amount"));
    // one question for all the roles first, then the business model, then the metrics
    expect(asked.slice(0, 2).map((q) => q.split(/[?:(]/)[0])).toEqual(["Column roles", "Business model subscription"]);
    expect(asked.some((q) => q.startsWith("Role "))).toBe(false);
    expect(asked.indexOf("Metric revenue?")).toBe(2);
    const report = JSON.parse(readFileSync(r.reportPath as string, "utf8")) as Report;
    expect(report.roles?.every((x) => x.status === "confirmed")).toBe(true);
    expect(report.business_model?.status).toBe("confirmed");
    await manager.delete(r.jobId);
  }, 180_000);

  it("interactive review: changing a role re-drafts the metrics before they are shown; an unknown role is refused and asked again", async () => {
    const lines: string[] = [];
    const asked: string[] = [];
    let edits = 0;
    const review = {
      show: (l: string) => lines.push(l),
      async choose(q: string): Promise<ReviewChoice> {
        asked.push(q);
        // The first time through, go through the roles one by one and edit the channel's; the second time, accept everything.
        if (edits < 2 && q.startsWith("Column roles:")) return "edit";
        return q === "Role t_t1.Channel?" && edits < 2 ? "edit" : "accept";
      },
      // First a role that is not in the vocabulary (refused), then a valid one.
      async edit() {
        return ++edits === 1 ? "wizard" : "role: dimension";
      },
    };
    const r = await analyzeCommand(
      { files, options, out: join(tmp, "out-edit"), jobId: "cli-role-edit" },
      { manager, print: (l) => lines.push(l), review },
    );
    expect(r.code).toBe(0);
    expect(lines.some((l) => l.startsWith('Not accepted: "wizard" is not a role of the vocabulary'))).toBe(true);
    expect(lines).toContain("Metrics drafted again from your role changes:");
    // the per-channel revenue metrics are not drafted any more, so they are never asked about
    expect(asked).not.toContain("Metric wholesale_revenue?");
    expect(asked).toContain("Metric revenue?");
    const report = JSON.parse(readFileSync(r.reportPath as string, "utf8")) as Report;
    expect(report.metrics.map((m) => m.id)).toEqual([
      "revenue",
      "orders",
      "units",
      "customers",
      "new_customers",
      "returning_customers",
      "aov",
      "refund_rate",
    ]);
    expect(report.roles?.find((x) => x.table_id === "T1" && x.column === "channel")).toMatchObject({
      role: "dimension",
      source: "user",
      status: "confirmed",
    });
    await manager.delete(r.jobId);
  }, 240_000);

  it("interactive review: a bad edit is refused and reviewed again; dropped metrics leave the report", async () => {
    const lines: string[] = [];
    const answers: ReviewChoice[] = [];
    let round = 0;
    const review = {
      show: (l: string) => lines.push(l),
      async choose(q: string): Promise<ReviewChoice> {
        // Round 1: edit revenue badly. Round 2: accept revenue, drop "units" (nothing divides by it; dropping "orders" would also refuse aov, which needs it), accept the rest.
        const c: ReviewChoice = round === 0 && q === "Metric revenue?" ? "edit" : round === 1 && q === "Metric units?" ? "drop" : "accept";
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
    expect(report.metrics.map((m) => m.id)).not.toContain("units");
    expect(report.metrics.every((m) => m.status === "confirmed")).toBe(true);
    expect(answers).toContain("drop");
  }, 180_000);

  it("interactive review: when the input ends, it stops (exit 1) instead of asking again", async () => {
    const lines: string[] = [];
    let asked = 0;
    const review = {
      show: (l: string) => lines.push(l),
      async choose(): Promise<ReviewChoice> {
        asked++;
        if (asked > 1) throw new ReviewEndedError();
        return "accept";
      },
      edit: async () => "",
    };
    const r = await analyzeCommand(
      { files, options, out: join(tmp, "out3"), jobId: "cli-ended" },
      { manager, print: (l) => lines.push(l), review },
    );
    expect(r.code).toBe(1);
    expect(asked).toBe(2);
    expect(lines).toContain("The review ended before every metric was answered; the job is waiting for its roles and metrics.");
    await manager.delete(r.jobId);
  }, 60_000);

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
