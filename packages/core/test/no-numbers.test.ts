// Backtest pre-tag 1: a job that read no numbers says so (report-schema §1, agent-and-verifier §6) instead of the
// false all-clear "No material changes". No model is called: a FakeModel with an empty script throws on any call.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { FakeModel } from "@agentic-analytics/models/testing";
import { reportSummaryText } from "@agentic-analytics/report";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { afterAll, describe, expect, it } from "vitest";
import { runJob } from "../src/index.ts";
import { coffeePlanner } from "../testing/coffee-planner.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const enc = (s: string) => new TextEncoder().encode(s);

async function run(files: { name: string; bytes: Uint8Array }[]) {
  const dir = mkdtempSync(join(tmpdir(), "aa-nonum-"));
  dirs.push(dir);
  return runJob({ dir, files, options: { today: "2024-01-01", currency: "UZS" } }, { model: new FakeModel([]), embedder: hashEmbedder() });
}

describe("a job that read no numbers", () => {
  it("a text file with no table: the headline says no table was found, and no model is called", async () => {
    const { report } = await run([{ name: "notes.txt", bytes: enc("The board met and discussed the strategy for the coming year.\n") }]);
    expect(report.summary.headline).toBe("No numbers could be read from these files: no table was found.");
    expect(report.summary.no_numbers).toBe("no_table");
    expect(report.summary.headline).not.toMatch(/No material changes/);
  }, 120_000);

  it("a CSV whose headers are not recognised: says the headers were not recognised", async () => {
    const { report } = await run([{ name: "odd.csv", bytes: enc("foo,bar,baz\nalpha,beta,gamma\none,two,three\nx,y,z\n") }]);
    expect(report.summary.headline).toBe(
      "No numbers could be read from these files: the column headers were not recognised as a date and an amount.",
    );
    expect(report.summary.no_numbers).toBe("headers_not_recognised");
  }, 120_000);

  it("only a gzip file: says every file was rejected, and the summary lists it under Files not read", async () => {
    const { report } = await run([{ name: "listings.csv.gz", bytes: new Uint8Array([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 3]) }]);
    expect(report.summary.headline).toBe("No numbers could be read from these files: every file was rejected (see Files not read).");
    expect(report.summary.no_numbers).toBe("files_rejected");
    const t = reportSummaryText(report);
    expect(t).toContain("Files not read:");
    expect(t).not.toMatch(/\{\{N\d+\}\}/);
  }, 120_000);

  it("a normal job with findings is unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-nonum-ok-"));
    dirs.push(dir);
    const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
    const { report } = await runJob(
      { dir, files, options: { today: "2026-07-01", currency: "USD" } },
      { model: coffeePlanner(), embedder: hashEmbedder() },
    );
    expect(report.summary.no_numbers).toBeUndefined();
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.summary.headline).not.toMatch(/No numbers could be read/);
  }, 180_000);
});
