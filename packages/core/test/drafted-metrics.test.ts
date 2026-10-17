// Every job saves its drafted metrics (before validation, with the validation result) to the job folder, even when a
// later stage fails, so a failure like construction_supplier-v1's (a self-ratio that broke MEASURE) can be inspected.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import type { DraftRecord } from "@agentic-analytics/metrics";
import type { GenerateObjectArgs, ModelClient } from "@agentic-analytics/models";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { afterAll, describe, expect, it } from "vitest";
import { DRAFTED_METRICS, runJob } from "../src/index.ts";
import { coffeePlanner } from "../testing/coffee-planner.ts";

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "aa-drafted-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
const options = { today: "2026-07-01", currency: "USD" };

// What a real model drafted on construction_supplier-v1, in kind: a valid metric and a ratio of it to itself.
const DRAFT = {
  metrics: [
    { id: "revenue", label: "Revenue", type: "sum", table: "t_t1", expression: "amount", unit: "currency" },
    {
      id: "revenue_share",
      label: "Revenue share",
      type: "ratio",
      numerator: { metric: "revenue" },
      denominator: { metric: "revenue" },
      unit: "ratio",
    },
  ],
};

describe("metrics.drafted.json in the job folder", () => {
  it("records the model's draft and why the self-ratio was rejected, even though the job then fails", async () => {
    const dir = tempDir();
    const planner = coffeePlanner();
    const model: ModelClient = {
      generateObject<T>(a: GenerateObjectArgs<T>) {
        if (a.prompt.startsWith("Propose metric definitions"))
          return Promise.resolve({ object: DRAFT as T, usage: { inputTokens: 0, outputTokens: 0, latencyMs: 0 } });
        // DECIDE's model call fails (the provider went down), after METRICS_DRAFT has run.
        if (a.prompt.includes("Propose the candidate actions")) return Promise.reject(new Error("provider unavailable"));
        return planner.generateObject(a);
      },
      generateWithTools: (a) => planner.generateWithTools(a),
      embed: (t) => planner.embed(t),
    };
    await expect(runJob({ dir, files, options }, { model, embedder: hashEmbedder() })).rejects.toMatchObject({ code: "STAGE_FAILED" });
    const path = join(dir, DRAFTED_METRICS);
    expect(existsSync(path)).toBe(true);
    const record = JSON.parse(readFileSync(path, "utf8")) as DraftRecord;
    expect(record.source).toBe("model");
    expect(record.proposals).toEqual(DRAFT.metrics);
    expect(record.accepted.map((m) => m.id)).toEqual(["revenue"]);
    expect(record.rejected).toEqual([
      expect.objectContaining({ id: "revenue_share", reasons: ['ratio "revenue_share" divides "revenue" by itself (always 1)'] }),
    ]);
  }, 180_000);

  it("records the fallback drafts when there is no model draft", async () => {
    const dir = tempDir();
    const out = await runJob({ dir, files, options }, { model: coffeePlanner(), embedder: hashEmbedder() });
    expect(out.run.ran).toContain("METRICS_DRAFT");
    const record = JSON.parse(readFileSync(join(dir, DRAFTED_METRICS), "utf8")) as DraftRecord;
    expect(record.source).toBe("fallback");
    expect(record.note).toMatch(/model was unavailable/);
    expect(record.proposals.length).toBe(record.accepted.length + record.rejected.length);
    expect(record.accepted.map((m) => m.id)).toContain("revenue");
  }, 180_000);
});
