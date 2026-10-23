import { describe, expect, it } from "vitest";
import { type CapabilityBaseline, capabilityLines, type GoldenRunResult, loadCapabilityBaseline } from "../src/index.ts";

const caps = (o: Partial<Record<string, [number, number]>>) =>
  Object.fromEntries(["kpi", "margin", "pareto", "driver", "other"].map((c) => [c, { passed: o[c]?.[0] ?? 0, of: o[c]?.[1] ?? 0 }]));
const run = (byCapability: Record<string, { passed: number; of: number }>): GoldenRunResult =>
  ({ summary: { byCapability } }) as unknown as GoldenRunResult;

describe("the per-capability table", () => {
  it("pools the runs and prints counts, the baseline and the bar (hand-computed)", () => {
    // kpi: (3/4 + 1/2) = 4/6 = 66.7%; baseline 2/5 = 40% -> bar max(55%, 85%) = 85%.
    // margin: no counted items in the baseline -> bar n/a. pareto: 2/2 = 100%; baseline 4/5 = 80% -> bar max(95%, 85%) = 95%.
    const baseline = {
      engine_commit: "abc",
      date: "2026-10-23",
      split: "dev",
      model: "baseline",
      capabilities: caps({ kpi: [2, 5], pareto: [4, 5] }),
    } as unknown as CapabilityBaseline;
    const lines = capabilityLines([run(caps({ kpi: [3, 4], pareto: [1, 1] })), run(caps({ kpi: [1, 2], pareto: [1, 1] }))], baseline);
    expect(lines[1]).toMatch(/^kpi +4\/6 +66\.7% +2\/5 = 40\.0% +85\.0%$/);
    expect(lines[2]).toMatch(/^margin +0\/0 +n\/a +0\/0 = n\/a +n\/a$/);
    expect(lines[3]).toMatch(/^pareto +2\/2 +100\.0% +4\/5 = 80\.0% +95\.0%$/);
  });

  it("prints n/a for the baseline and the bar when none is committed", () => {
    expect(capabilityLines([run(caps({ kpi: [1, 2] }))])[1]).toMatch(/^kpi +1\/2 +50\.0% +n\/a +n\/a$/);
  });

  it("the committed M14-engine baseline loads and every M14 count is within its item count", () => {
    const b = loadCapabilityBaseline();
    expect(b?.engine_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(b?.model).toBe("baseline");
    for (const c of Object.values(b?.capabilities ?? {})) expect(c.passed).toBeLessThanOrEqual(c.of);
  });
});
