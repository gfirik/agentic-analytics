// The scenario a planner may ask for, in `propose_scenario` (EXPLAIN) and in a DECIDE candidate: one of the four
// fixed impact templates of analysis' `ScenarioRequest` (docs/specs/analysis-library.md §5), naming existing facts.
import { z } from "zod";

export const ScenarioInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("recover_share"), lost: z.string(), low: z.number(), high: z.number(), discount: z.number().optional() }),
  z.object({ type: z.literal("price_change"), revenue: z.string(), low: z.number(), high: z.number() }),
  z.object({
    type: z.literal("remove_excess_rate"),
    current: z.string(),
    baseline: z.string(),
    base: z.string(),
    low: z.number(),
    high: z.number(),
  }),
  z.object({ type: z.literal("retain_at_risk"), atRisk: z.string(), low: z.number(), high: z.number(), cost: z.number().optional() }),
]);
