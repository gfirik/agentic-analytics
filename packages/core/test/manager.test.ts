// M10: the job manager every door uses. A job paused for metric review resumes once definitions are confirmed,
// RENDER writes report.html, follow-up answers are verified claims, and a number can be explained.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import type { JobEvent } from "@agentic-analytics/schema";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { JobManager, type JobStatus } from "../src/index.ts";
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
    // A subscriber joining the resumed run still sees the stages before the pause.
    const late: JobEvent[] = [];
    const stop = await manager.subscribe(id, (e) => late.push(e));
    expect(late.some((e) => e.type === "stage_completed" && e.stage === "INGEST")).toBe(true);
    stop();
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
    // A question with digits is never a finding's title, so it can't make the whole answer unverifiable (V1).
    const digits = await manager.ask(id, "Why did revenue drop 10% in Q2?");
    expect(digits.claims.map((c) => c.text)).toEqual(a.claims.map((c) => c.text));
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

  it("keeps every uploaded file (no overwrite, no '..'), and one broken job doesn't stall the queue", async () => {
    const m = new JobManager({
      root: join(root, "edge"),
      model,
      deps: (o) => {
        if (o.objective === "boom") throw new Error("deps failed");
        return { model: coffeePlanner(), embedder: hashEmbedder() };
      },
    });
    const bytes = new TextEncoder().encode("a,b\n1,2\n");
    await m.create(
      [
        { name: "x/sales.csv", bytes },
        { name: "y\\sales.csv", bytes },
        { name: "..", bytes },
      ],
      { today: "2026-07-01" },
      "names",
    );
    expect(readdirSync(join(root, "edge", "names", "input")).sort()).toEqual(["file-3", "sales (2).csv", "sales.csv"]);
    // A job that throws before it starts fails on its own; the job queued after it still runs.
    await m.create(files.slice(0, 1), { today: "2026-07-01", objective: "boom" }, "broken");
    await m.create(files.slice(0, 1), { today: "2026-07-01" }, "next");
    expect((await m.wait("broken")).error?.message).toBe("deps failed");
    expect(["done", "failed"]).toContain((await m.wait("next")).status);
    expect((await m.status("next")).error?.message).not.toBe("deps failed");
  }, 180_000);

  it("lists, refuses unknown ids and deletes", async () => {
    expect((await manager.list()).map((s) => s.job_id)).toEqual(["coffee-review"]);
    await expect(manager.status("../etc")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(manager.status("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A refused id leaves no waiter entry behind.
    await expect(manager.wait("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((manager as unknown as { waiters: Map<string, unknown> }).waiters.has("nope")).toBe(false);
  });

  it("wait resolves when the job ends while its status read is still pending (no lost notification)", async () => {
    // The job's terminal write lands between wait's status read and its return: the read still sees "running".
    // The waiter must already be registered, or the notification is lost and the wait never resolves.
    const internal = manager as unknown as { write(id: string, patch: Partial<JobStatus>): JobStatus };
    const before = await manager.status(id);
    const spy = vi.spyOn(manager, "status").mockImplementationOnce(async () => {
      internal.write(id, { status: "done" });
      return { ...before, status: "running" };
    });
    try {
      expect((await manager.wait(id)).status).toBe("done");
    } finally {
      spy.mockRestore();
      internal.write(id, { status: before.status });
    }
  });
});

describe("JobManager.subscribe", () => {
  // An event the job emits while the history is being read: it is dispatched to listeners but not in the snapshot.
  class Racy extends JobManager {
    override async events(jobId: string): Promise<JobEvent[]> {
      const history = await super.events(jobId);
      const last = history.at(-1) as JobEvent;
      const next = { ...last, seq: last.seq + 1 } as JobEvent;
      const listeners = (this as unknown as { listeners: Map<string, Set<(e: JobEvent) => void>> }).listeners;
      for (const l of listeners.get(jobId) ?? []) l(next);
      return history;
    }
  }

  it("delivers an event emitted while the history is read, once and in order", async () => {
    const racy = new Racy({ root, model, deps: () => ({ model: coffeePlanner(), embedder: hashEmbedder() }) });
    const got: JobEvent[] = [];
    const stop = await racy.subscribe(id, (e) => got.push(e));
    stop();
    const seqs = got.map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i));
    expect(seqs.at(-1)).toBe((await manager.events(id)).length);
  });
});

describe("JobManager: one writer per job", () => {
  // A job that fails before it touches DuckDB: resume and confirm reach their first await at once.
  const failing = () =>
    new JobManager({
      root: mkdtempSync(join(root, "busy-")),
      model,
      deps: () => {
        throw new Error("no model");
      },
    });
  const csv = [{ name: "a.csv", bytes: new TextEncoder().encode("a,b\n1,2\n") }];

  it("two concurrent resumes: one queues the job, the other is BUSY", async () => {
    const m = failing();
    await m.create(csv, { today: "2026-07-01" }, "twice");
    expect((await m.wait("twice")).status).toBe("failed");
    const out = await Promise.allSettled([m.resume("twice"), m.resume("twice")]);
    expect(out.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(out.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "BUSY" } });
    await m.wait("twice");
  });

  it("a resume, a metrics read or a delete during a confirm is BUSY", async () => {
    const m = failing();
    await m.create(csv, { today: "2026-07-01" }, "held");
    await m.wait("held");
    const confirming = m.confirm("held", "metrics: []\n");
    await expect(m.resume("held")).rejects.toMatchObject({ code: "BUSY" });
    await expect(m.metrics("held")).rejects.toMatchObject({ code: "BUSY" });
    await expect(m.delete("held")).rejects.toMatchObject({ code: "BUSY" });
    await confirming.catch(() => undefined);
    // Released once the confirm ends, whatever its outcome.
    await m.resume("held");
    await m.wait("held");
  });

  it("a resume, a confirm or a delete during an open metrics read is BUSY", async () => {
    const m = failing();
    await m.create(csv, { today: "2026-07-01" }, "read");
    await m.wait("read");
    // The read counts as open from the call itself, before its first await.
    const reading = m.metrics("read");
    await expect(m.resume("read")).rejects.toMatchObject({ code: "BUSY" });
    await expect(m.confirm("read", "metrics: []\n")).rejects.toMatchObject({ code: "BUSY" });
    await expect(m.delete("read")).rejects.toMatchObject({ code: "BUSY" });
    await reading.catch(() => undefined);
    await m.resume("read");
    await m.wait("read");
  });
});

describe("JobManager: status files and upload names", () => {
  const bytes = new TextEncoder().encode("a,b\n1,2\n");
  const idle = () =>
    new JobManager({
      root: mkdtempSync(join(root, "files-")),
      model,
      deps: () => {
        throw new Error("no model");
      },
    });

  it("a failed status write leaves the previous status.json whole", async () => {
    const m = idle();
    await m.create([{ name: "a.csv", bytes }], { today: "2026-07-01" }, "atomic");
    await m.wait("atomic");
    const path = join(m.root, "atomic", "status.json");
    const before = readFileSync(path, "utf8");
    // The temporary sibling can't be created: the write fails before the real file is touched.
    mkdirSync(`${path}.${process.pid}.tmp`);
    const internal = m as unknown as { write(id: string, patch: Partial<JobStatus>): JobStatus };
    expect(() => internal.write("atomic", { status: "queued" })).toThrow();
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("a job whose status.json is cut short is listed as failed, and the rest still list", async () => {
    const m = idle();
    await m.create([{ name: "a.csv", bytes }], { today: "2026-07-01" }, "good");
    await m.create([{ name: "a.csv", bytes }], { today: "2026-07-01" }, "torn");
    await m.wait("good");
    await m.wait("torn");
    writeFileSync(join(m.root, "torn", "status.json"), '{"job_id": "torn", "sta');
    const list = await m.list();
    expect(list.map((s) => s.job_id)).toEqual(["good", "torn"]);
    expect(list[1]).toMatchObject({ status: "failed", error: { code: "UNREADABLE_STATUS" } });
    // A resume writes a whole status again.
    await m.resume("torn");
    await m.wait("torn");
    expect(JSON.parse(readFileSync(join(m.root, "torn", "status.json"), "utf8")).job_id).toBe("torn");
  });

  it("cleans and shortens upload names: NUL and control characters, 300-character names", async () => {
    const m = idle();
    const long = `${"é".repeat(300)}.csv`;
    await m.create(
      [
        { name: "sa\u0000les\n.csv", bytes },
        { name: long, bytes },
        { name: long, bytes },
      ],
      { today: "2026-07-01" },
      "names",
    );
    const names = readdirSync(join(m.root, "names", "input")).sort();
    expect(names).toHaveLength(3);
    expect(names).toContain("sales.csv");
    for (const n of names) {
      expect(new TextEncoder().encode(n).length).toBeLessThanOrEqual(255);
      expect(n.endsWith(".csv")).toBe(true);
    }
    expect(names.some((n) => n.endsWith(" (2).csv"))).toBe(true);
    await m.wait("names");
  });

  it("a job that can't be written leaves no folder behind", async () => {
    const m = idle();
    // JSON can't hold a BigInt: options.json fails after the input files are written.
    const options = { today: "2026-07-01", objective: 1n } as unknown as { today: string };
    await expect(m.create([{ name: "a.csv", bytes }], options, "half")).rejects.toThrow();
    expect(existsSync(join(m.root, "half"))).toBe(false);
  });
});
