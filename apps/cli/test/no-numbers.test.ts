// Backtest pre-tag 1: a job that read no numbers exits 2 (a warning, not a failure) and prints why. No model is
// called: the FakeModel has an empty script and throws on any call.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobManager } from "@agentic-analytics/core";
import { FakeModel } from "@agentic-analytics/models/testing";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { afterAll, describe, expect, it } from "vitest";
import { analyzeCommand } from "../src/analyze.ts";
import { runCommand } from "../src/run.ts";

const tmp = mkdtempSync(join(tmpdir(), "aa-nonum-cli-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const files = [{ name: "notes.txt", bytes: new TextEncoder().encode("The board met and discussed the strategy.\n") }];
const options = { today: "2024-01-01", currency: "UZS" };

describe("a job that read no numbers", () => {
  it("aa analyze prints the reason, what was read, and exits 2", async () => {
    const model = new FakeModel([]);
    const manager = new JobManager({ root: join(tmp, "jobs"), model, deps: () => ({ model, embedder: hashEmbedder() }) });
    const lines: string[] = [];
    const r = await analyzeCommand({ files, options, out: join(tmp, "out") }, { manager, print: (l) => lines.push(l) });
    expect(r.code).toBe(2);
    expect(lines).toContain("No numbers could be read from these files: no table was found.");
    expect(lines).toContain("Read: notes.txt (document)");
    expect(lines.join("\n")).not.toContain("No material changes");
  }, 120_000);

  it("aa run exits 2 too", async () => {
    const lines: string[] = [];
    const code = await runCommand(
      { dir: join(tmp, "run"), files, options },
      { model: new FakeModel([]), embedder: hashEmbedder(), out: (l) => lines.push(l) },
    );
    expect(code).toBe(2);
    expect(lines).toContain("No numbers could be read from these files: no table was found.");
  }, 120_000);
});
