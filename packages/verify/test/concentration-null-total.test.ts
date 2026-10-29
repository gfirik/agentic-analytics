// V2's `pareto_class` rule reads the member totals the fact's SQL returns. A member whose measure is missing on every row
// of the window has a NULL total: the template's `total <= 0` doesn't count it as non-positive, so the code path must not
// either (found on Montgomery County's item codes, M15 PR 11 prep).
import type { Fact } from "@agentic-analytics/schema";
import { Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recheckStat } from "../src/concentration-check.ts";

let ws: Workspace;
beforeAll(async () => {
  ws = await Workspace.open();
});
afterAll(() => ws.close());

const fact = (value: number): Fact =>
  ({
    id: "N1",
    label: "pareto.nonpositive_count.product_ttm",
    value,
    unit: "count",
    computation: {
      kind: "sql",
      // a 5, b no value, c −1: one non-positive member (c), as the template counts it.
      sql: "SELECT key, total, 1 AS value FROM (VALUES ('a', 5.0), ('b', NULL), ('c', -1.0)) t(key, total)",
      params: { stat: { part: "nonpositive_count", a_cut: 80, b_cut: 95 } },
    },
  }) as unknown as Fact;

describe("pareto_class with a member that has no value", () => {
  it("counts only the member whose total is ≤ 0, not the one whose total is NULL", async () => {
    const r = await recheckStat(ws, fact(1), { part: "nonpositive_count", a: 80, b: 95 }, (x, y) => x === y);
    expect(r.computed).toBe(1);
    expect(r.ok).toBe(true);
  });
});
