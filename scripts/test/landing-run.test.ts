// The landing page shows ONE run: the hero animation (docs/assets/readme/pipeline.json) and the report card, its fact
// ledger and its counts (apps/docs/scripts/landing-data.ts) come from the same web-enabled engine run, so a reader
// comparing them sees the same counts and the same fact ids.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { disagreements, landingData } from "../../apps/docs/scripts/landing-data.ts";
import { PIPELINE_JSON, recordRun } from "../../apps/docs/scripts/pipeline-data.ts";
import type { PipelineData } from "../../apps/docs/src/components/pipeline-scene.ts";

// One engine run (offline, deterministic) shared by both tests.
let run: ReturnType<typeof recordRun> | undefined;
const landingOfRun = async () => {
  run = run ?? recordRun();
  return landingData((await run).report);
};

describe("landing page: one run throughout", () => {
  it("the report card agrees with the hero: verification counts, recommendation and impact fact ids, the headline fact", async () => {
    const landing = await landingOfRun();
    const hero = JSON.parse(readFileSync(PIPELINE_JSON, "utf8")) as PipelineData;
    expect(disagreements(landing, hero)).toEqual([]);
    expect(landing.recommendation.low).toBe(hero.action.low.id);
    expect(landing.verification.numbers_checked).toBe(hero.verification.numbers_checked);
  }, 120_000);

  it("disagreements() reports a different run (the check works)", async () => {
    const landing = await landingOfRun();
    const hero = JSON.parse(readFileSync(PIPELINE_JSON, "utf8")) as PipelineData;
    const other = {
      ...hero,
      verification: { ...hero.verification, numbers_checked: hero.verification.numbers_checked - 3 },
      action: { ...hero.action, low: { ...hero.action.low, id: "N329" } },
    };
    expect(disagreements(landing, other).length).toBe(2);
  }, 120_000);
});
