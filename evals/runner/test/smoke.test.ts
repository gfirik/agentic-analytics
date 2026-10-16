// The smoke suite (docs/EVALS.md §3, CI on every PR): three generated datasets end to end with the baseline
// scripted model. It checks the plumbing and the invariants that hold for any model: every job completes, no
// number mismatches, every recommendation grounded, every definition adhered to; and that the key-client loss
// planted in each dataset is found with its driver.
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { describe, expect, it } from "vitest";
import { baselineModel, resultsMarkdown, runSuite } from "../src/index.ts";

describe("smoke suite", () => {
  it("runs three datasets end to end with FakeModel", async () => {
    const r = await runSuite({ suite: "smoke", model: () => baselineModel(), modelName: "baseline", embedder: hashEmbedder() });
    expect(r.datasets).toBe(3);
    const bar = (m: string) => r.bars.find((b) => b.metric === m)?.value;
    expect(bar("Jobs completed")).toBe(1);
    expect(bar("Number mismatches")).toBe(0);
    expect(bar("Definition adherence")).toBe(1);
    expect(bar("Recommendation grounding")).toBe(1);
    for (const s of r.scores)
      expect(
        s.planted.find((p) => p.id === "P1"),
        s.dataset,
      ).toMatchObject({ detected: true, driver: true });
    expect(resultsMarkdown(r)).toContain("| Planted recall@5 |");
  }, 300_000);
});
