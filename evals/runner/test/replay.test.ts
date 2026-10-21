// The M14a recall fix end to end (docs/plans/analyst-grade.md M14a item 1): FakeModel in small-model mode (3 findings)
// with a real model's drafted metrics, kept by the 2026-10-20 nightly run (fixtures/replay, proposals only). With
// 8–15 drafted metrics, the families restating the revenue drop used to take every slot after it: P2 (clinic-v2's
// refund rate) and P3 (clinic-v3's cannibalized product) were never explained. printing_shop-v3's product change is
// found on a channel slice and must be told through the objective (`total_revenue`), where the answer key names it.
import { fileURLToPath } from "node:url";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { describe, expect, it } from "vitest";
import { baselineModel, replayedDrafts, runSuite, suiteDatasets } from "../src/index.ts";

const FIXTURES = fileURLToPath(new URL("./fixtures/replay", import.meta.url));
const CASES = [
  ["clinic-v2", "P2"],
  ["clinic-v3", "P3"],
  ["printing_shop-v3", "P3"],
] as const;

describe("replayed drafts in small-model mode", () => {
  it("explains the planted rate and product events, not only the lead drop", async () => {
    const ids: readonly string[] = CASES.map(([id]) => id);
    const r = await runSuite({
      suite: "full",
      datasets: suiteDatasets("full").filter((d) => ids.includes(d.id)),
      model: (_onCall, id) => {
        const drafts = replayedDrafts(FIXTURES, id);
        if (!drafts) throw new Error(`no kept draft for ${id}`);
        return baselineModel({ small: true, drafts });
      },
      modelName: "baseline (replayed drafts)",
      embedder: hashEmbedder(),
      smallModel: true,
    });
    for (const [id, planted] of CASES) {
      const s = r.scores.find((x) => x.dataset === id);
      expect(s?.completed, id).toBe(true);
      expect(s?.findings, id).toBe(3);
      expect(
        s?.planted.find((p) => p.id === "P1"),
        id,
      ).toMatchObject({ detected: true, rank: 1 });
      expect(
        s?.planted.find((p) => p.id === planted),
        `${id} ${planted}`,
      ).toMatchObject({ detected: true });
    }
  }, 300_000);
});
