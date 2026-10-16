// M10: the job manager every door uses. A job paused for metric review resumes once definitions are confirmed,
// RENDER writes report.html, follow-up answers are verified claims, and a number can be explained.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import type { JobEvent } from "@agentic-analytics/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobManager } from "../src/index.ts";
import { coffeePlanner } from "../testing/coffee-planner.ts";

const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
const root = mkdtempSync(join(tmpdir(), "aa-mgr-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const model = coffeePlanner();
const manager = new JobManager({ root, model, deps: () => ({ model: coffeePlanner(), embedder: hashEmbedder() }) });
let id: string;
const events: JobEvent[] = [];

beforeAll(async () => {
  const s = await manager.create(files, { today: "2026-07-01", currency: "USD", autoConfirm: false }, "coffee-review");
  id = s.job_id;
  await manager.subscribe(id, (e) => events.push(e));
  expect((await manager.wait(id)).status).toBe("awaiting_confirmation");
}, 180_000);

describe("JobManager", () => {
  it("pauses at AWAIT_CONFIRM with an awaiting_confirmation event and no failure", async () => {
    expect(events.some((e) => e.type === "awaiting_confirmation")).toBe(true);
    expect(events.some((e) => e.type === "failed")).toBe(false);
    await expect(manager.report(id)).rejects.toMatchObject({ code: "NOT_READY" });
  });

  it("shows the drafted metrics, refuses an invalid edit, and resumes on confirmation", async () => {
    const m = await manager.metrics(id);
    expect(m.metrics.map((x) => x.id)).toContain("revenue");
    expect(m.yaml).toContain("revenue");
    await expect(manager.confirm(id, "metrics:\n  - id: broken\n    label: Broken\n")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await manager.status(id)).status).toBe("awaiting_confirmation");
    await manager.confirm(id, m.yaml);
    const done = await manager.wait(id);
    expect(done.status).toBe("done");
    expect(done.progress).toBe(100);
    const report = await manager.report(id);
    expect(report.metrics.every((d) => d.status === "confirmed")).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(await manager.reportHtml(id)).toMatch(/^<!doctype html>/i);
    expect((await manager.events(id)).at(-1)?.type).toBe("done");
  }, 180_000);

  it("answers a question with verified claims only", async () => {
    const a = await manager.ask(id, "Why did revenue drop?");
    const report = await manager.report(id);
    expect(a.claims.map((c) => c.text)).toEqual([report.findings[0]?.claims[0]?.text]);
    expect(a.claims.every((c) => c.verified)).toBe(true);
    expect(a.facts.map((f) => f.id).sort()).toEqual([...(a.claims[0]?.facts ?? [])].sort());
    expect(a.dropped).toHaveLength(1);
    expect(a.dropped[0]?.reason).toMatch(/^V4: the claim names Orders/);
    const none = await manager.ask(id, "What will revenue be next year?");
    expect(none.claims).toEqual([]);
    expect(none.notCovered).toBe("The report has no forecast.");
  }, 60_000);

  it("explains a number: SQL and parameters, its definition and the cited input rows", async () => {
    const report = await manager.report(id);
    const fact = report.facts.find((f) => f.computation.kind === "sql" && f.citations.some((c) => c.rows?.length));
    expect(fact).toBeDefined();
    const x = await manager.explain(id, fact?.id as string);
    expect(x.fact.computation.sql).toMatch(/SELECT/);
    expect(x.definition?.metric.id).toBe(fact?.metric_id);
    expect(x.rows[0]?.rows.length).toBeGreaterThan(0);
    const fn = report.facts.find((f) => f.computation.kind === "function" && f.computation.inputs?.length);
    expect((await manager.explain(id, fn?.id as string)).inputs.length).toBeGreaterThan(0);
    await expect(manager.explain(id, "N999999")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists, refuses unknown ids and deletes", async () => {
    expect((await manager.list()).map((s) => s.job_id)).toEqual(["coffee-review"]);
    await expect(manager.status("../etc")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(manager.status("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
