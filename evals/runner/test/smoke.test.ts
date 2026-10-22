// The smoke suite (docs/EVALS.md §3, CI on every PR): three development datasets and one held-out dataset end to end
// with the baseline scripted model. It checks the plumbing and the invariants that hold for any model: every job
// completes, no number mismatches, every recommendation grounded, every definition adhered to; and that the
// key-client loss planted in each development dataset is found with its driver. The held-out dataset (the held-out
// set's CI path, docs/specs/accuracy.md §9) is checked for the invariants and scored, never for its recall: a CI
// check on what it finds would make it a development target.

import { HELDOUT_SMOKE } from "@agentic-analytics/eval-generator";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { describe, expect, it } from "vitest";
import { baselineModel, resultsMarkdown, runSuite } from "../src/index.ts";

describe("smoke suite", () => {
  it("runs three development datasets and one held-out dataset end to end with FakeModel", async () => {
    const r = await runSuite({ suite: "smoke", model: () => baselineModel(), modelName: "baseline", embedder: hashEmbedder() });
    expect(r.datasets).toBe(4);
    expect(r.scores.map((s) => s.dataset)).toContain(HELDOUT_SMOKE);
    const bar = (m: string) => r.bars.find((b) => b.metric === m)?.value;
    expect(bar("Jobs completed")).toBe(1);
    expect(bar("Number mismatches")).toBe(0);
    expect(bar("Definition adherence")).toBe(1);
    expect(bar("Recommendation grounding")).toBe(1);
    const held = r.scores.find((s) => s.dataset === HELDOUT_SMOKE);
    expect(held).toMatchObject({ completed: true, numberMismatch: false, definitionViolations: 0 });
    expect(held?.planted.length).toBeGreaterThan(0);
    for (const s of r.scores.filter((x) => x.dataset !== HELDOUT_SMOKE))
      expect(
        s.planted.find((p) => p.id === "P1"),
        s.dataset,
      ).toMatchObject({ detected: true, driver: true });
    expect(resultsMarkdown(r)).toContain("| Planted recall@5 |");
  }, 300_000);
});
