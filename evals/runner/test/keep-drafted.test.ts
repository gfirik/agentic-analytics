// `--keep-reports` also keeps each job's drafted metrics: the job folder is deleted after scoring, and a real model's
// draft (construction_supplier-v1's self-ratio, M13h) can't be re-created later.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAFTED_METRICS } from "@agentic-analytics/core";
import { afterAll, describe, expect, it } from "vitest";
import { keepDraftedMetrics } from "../src/run.ts";

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "aa-keep-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("keepDraftedMetrics", () => {
  it("copies metrics.drafted.json next to the kept report", () => {
    const job = tempDir();
    const keep = join(tempDir(), "kept");
    writeFileSync(join(job, DRAFTED_METRICS), '{"source":"model"}\n');
    keepDraftedMetrics(job, keep, "construction_supplier-v1");
    expect(readFileSync(join(keep, "construction_supplier-v1.metrics.drafted.json"), "utf8")).toBe('{"source":"model"}\n');
  });

  it("does nothing when the job failed before drafting", () => {
    const keep = join(tempDir(), "kept");
    keepDraftedMetrics(tempDir(), keep, "x");
    expect(existsSync(keep)).toBe(false);
  });
});
