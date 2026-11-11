// Backtest pre-tag 5: an engine caveat whose findings were all dropped by VERIFY is removed, not left as an orphan.
import type { Assumption } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import { liveAssumptions } from "../src/verify.ts";

const a = (id: string, affects: string[], caveat?: Assumption["caveat"]): Assumption => ({
  id,
  text: id,
  affects,
  ...(caveat ? { caveat } : {}),
});

describe("liveAssumptions", () => {
  it("removes a caveat none of whose findings survived, whichever the kind", () => {
    const out = liveAssumptions([a("A1", ["F1"], "seasonal"), a("A2", ["F1", "F2"], "nominal")], new Set(["F3"]));
    expect(out).toEqual([]);
  });
  it("keeps a caveat that still affects a live finding, trimming the dropped ones", () => {
    expect(liveAssumptions([a("A1", ["F1", "F2"], "seasonal")], new Set(["F2"]))).toEqual([a("A1", ["F2"], "seasonal")]);
  });
  it("leaves other assumptions as they were, even with nothing left to affect", () => {
    expect(liveAssumptions([a("A1", ["F1"]), a("A2", [])], new Set(["F9"]))).toEqual([a("A1", []), a("A2", [])]);
  });
});
