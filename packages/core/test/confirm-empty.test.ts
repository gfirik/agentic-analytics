// Pre-tag B3: a review that has nothing to review must not trap the job (semantics §5, metric-layer §3). Documents only:
// no pause. A table whose headers are not recognised: the pause stays, and confirming the empty draft is accepted.
// No model is called: a FakeModel with an empty script throws on any call.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { FakeModel } from "@agentic-analytics/models/testing";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { afterAll, describe, expect, it } from "vitest";
import { confirmJobMetrics, JobManager, runJob } from "../src/index.ts";
import { coffeePlanner } from "../testing/coffee-planner.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const enc = (s: string) => new TextEncoder().encode(s);
const notes = { name: "notes.txt", bytes: enc("The board met and discussed the strategy for the coming year.\n") };
const odd = { name: "odd.csv", bytes: enc("foo,bar,baz\nalpha,beta,gamma\none,two,three\nx,y,z\n") };

const root = mkdtempSync(join(tmpdir(), "aa-confirm-empty-"));
dirs.push(root);
const empty = () => ({ model: new FakeModel([]), embedder: hashEmbedder() });
const manager = new JobManager({ root, model: new FakeModel([]), deps: empty });
const coffee = new JobManager({ root, model: coffeePlanner(), deps: () => ({ model: coffeePlanner(), embedder: hashEmbedder() }) });
const EMPTY_YAML = "version: 1\ngrain: month\nmetrics: []\n";

describe("documents only, with review on", () => {
  it("does not pause: the report says no table was found", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-confirm-docs-"));
    dirs.push(dir);
    const { report } = await runJob(
      { dir, files: [notes], options: { today: "2024-01-01", currency: "UZS", autoConfirm: false } },
      empty(),
    );
    expect(report.summary.no_numbers).toBe("no_table");
  }, 120_000);
});

describe("a table whose headers are not recognised, with review on", () => {
  it("pauses, accepts the empty confirmation and ends with the headers report", async () => {
    await manager.create([odd], { today: "2024-01-01", currency: "UZS", autoConfirm: false }, "odd");
    expect((await manager.wait("odd")).status).toBe("awaiting_confirmation");
    expect((await manager.metrics("odd")).metrics).toEqual([]);
    await manager.confirm("odd", EMPTY_YAML);
    expect((await manager.wait("odd")).status).toBe("done");
    expect((await manager.report("odd")).summary.no_numbers).toBe("headers_not_recognised");
  }, 120_000);

  it("the library entry point accepts it too", async () => {
    await manager.create([odd], { today: "2024-01-01", currency: "UZS", autoConfirm: false }, "odd-lib");
    expect((await manager.wait("odd-lib")).status).toBe("awaiting_confirmation");
    expect(await confirmJobMetrics(join(root, "odd-lib"), EMPTY_YAML)).toEqual({ confirmed: 0 });
  }, 120_000);
});

describe("an empty list when metrics were drafted", () => {
  it("is still refused", async () => {
    await coffee.create(
      Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes })),
      {
        today: "2026-07-01",
        currency: "USD",
        autoConfirm: false,
      },
      "drafted",
    );
    expect((await coffee.wait("drafted")).status).toBe("awaiting_confirmation");
    await expect(coffee.confirm("drafted", EMPTY_YAML)).rejects.toThrow(/no metric definitions given/);
  }, 240_000);
});
