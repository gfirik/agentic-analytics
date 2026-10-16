// M7 acceptance: resume after killing the process mid-job. A child process runs the coffee job with a slow planner;
// it is killed (SIGKILL, no cleanup) while EXPLAIN runs. Re-running the same folder skips the completed stages,
// resets and re-runs EXPLAIN, and produces the same draft as an uninterrupted run.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import type { GenerateObjectArgs, ModelClient } from "@agentic-analytics/models";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import type { JobEvent, Report } from "@agentic-analytics/schema";
import { sql, Workspace } from "@agentic-analytics/store";
import { afterAll, describe, expect, it } from "vitest";
import { EventBus, runJob } from "../src/index.ts";
import { coffeePlanner } from "../testing/coffee-planner.ts";

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "aa-resume-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
const options = { today: "2026-07-01", currency: "USD" };
/** The draft without what legitimately differs between runs. */
const stable = (r: Report) => ({ ...r, generated_at: "", job_id: "" });

/** Runs scripts/coffee-job.ts in a child process and SIGKILLs it as soon as `stage` starts. */
function runAndKill(dir: string, stage: string): Promise<{ killed: boolean; seen: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", join(import.meta.dirname, "..", "scripts", "coffee-job.ts"), "--dir", dir, "--slow-ms", "400", "--events"],
      { cwd: join(import.meta.dirname, ".."), stdio: ["ignore", "pipe", "pipe"] },
    );
    const seen: string[] = [];
    let buf = "";
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (!line.startsWith("{")) continue;
        const e = JSON.parse(line) as JobEvent;
        if (e.type === "stage_started") seen.push(e.stage);
        // Kill once the stage has done part of its work (its first progress event), so the reset is exercised.
        if (e.type === "progress" && e.stage === stage) child.kill("SIGKILL");
      }
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal === "SIGKILL") resolve({ killed: true, seen });
      else if (code === 0) resolve({ killed: false, seen });
      else reject(new Error(`child exited with ${code}: ${err.slice(-2000)}`));
    });
  });
}

describe("resume after the process is killed mid-job (M7 acceptance)", () => {
  it("skips completed stages, re-runs EXPLAIN from a clean slate, and gives the same draft", async () => {
    const dir = tempDir();
    const killed = await runAndKill(dir, "EXPLAIN");
    expect(killed.killed).toBe(true);
    expect(killed.seen.at(-1)).toBe("EXPLAIN");
    // The killed run left partial work behind: EXPLAIN is still "running", with facts and extracts of its own.
    const left = await Workspace.open(join(dir, "job.duckdb"));
    const stage = await left.one<{ status: string; first_fact: number }>(
      sql`SELECT status, first_fact FROM job_stages WHERE stage = 'EXPLAIN'`,
    );
    const partialFacts = await left.one<{ n: number }>(
      sql`SELECT count(*) AS n FROM facts WHERE CAST(substr(id, 2) AS INTEGER) >= ${stage?.first_fact ?? 0}`,
    );
    const partialExtracts = await left.one<{ n: number }>(sql`SELECT count(*) AS n FROM extracts`);
    left.close();
    expect(stage?.status).toBe("running");
    expect(partialFacts?.n).toBeGreaterThan(0);
    expect(partialExtracts?.n).toBeGreaterThan(0);

    // Resume: no files, no options, just the folder.
    const resumed = await runJob({ dir }, { model: coffeePlanner(), embedder: hashEmbedder() });
    expect(resumed.run.ran).toEqual(["EXPLAIN", "DECIDE", "VERIFY"]);
    expect(resumed.run.resumed).toEqual(["EXPLAIN"]);

    const fresh = await runJob(
      { dir: tempDir(), jobId: "coffee-demo", files, options },
      { model: coffeePlanner(), embedder: hashEmbedder() },
    );
    expect(stable(resumed.report)).toEqual(stable(fresh.report));

    // One continuous event log: EXPLAIN started twice (killed, resumed), INGEST only once, then done.
    const ws = await Workspace.open(join(dir, "job.duckdb"));
    const events = await (await EventBus.open(ws, resumed.jobId)).history();
    ws.close();
    const started = events.filter((e) => e.type === "stage_started").map((e) => (e.type === "stage_started" ? e.stage : ""));
    expect(started.filter((s) => s === "INGEST")).toHaveLength(1);
    expect(started.filter((s) => s === "EXPLAIN")).toHaveLength(2);
    expect(events.at(-1)?.type).toBe("done");
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
  }, 180_000);

  it("a stage that throws fails the job loudly, and the next run resumes at that stage", async () => {
    const dir = tempDir();
    const broken = coffeePlanner();
    // DECIDE's model call fails the first time (e.g. the provider is down).
    const flaky: ModelClient = {
      generateObject<T>(a: GenerateObjectArgs<T>) {
        if (a.prompt.includes("Propose the candidate actions")) return Promise.reject(new Error("provider unavailable"));
        return broken.generateObject(a);
      },
      generateWithTools: (a) => broken.generateWithTools(a),
      embed: (t) => broken.embed(t),
    };
    await expect(runJob({ dir, files, options }, { model: flaky, embedder: hashEmbedder() })).rejects.toMatchObject({
      code: "STAGE_FAILED",
      stage: "DECIDE",
    });
    const again = await runJob({ dir }, { model: coffeePlanner(), embedder: hashEmbedder() });
    expect(again.run.ran).toEqual(["DECIDE", "VERIFY"]);
    expect(again.run.resumed).toEqual(["DECIDE"]);
    expect(again.report.recommendations.length).toBeGreaterThan(0);
  }, 180_000);
});
