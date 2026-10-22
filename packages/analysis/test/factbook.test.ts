import { loadCatalog } from "@agentic-analytics/metrics";
import type { MetricDef } from "@agentic-analytics/schema";
import { Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { factOf } from "../src/factbook.ts";
import { AnalysisError, FactBook, type SeriesInfo } from "../src/index.ts";
import { calcRef } from "../src/types.ts";

let ws: Workspace;
let book: FactBook;

const avg = { id: "aov", label: "AOV", type: "avg", table: "t", expression: "x", unit: "currency", status: "assumed" } satisfies MetricDef;
const series = new Map<string, SeriesInfo>([
  ["aov", { def: avg, series: { id: "aov", metric: "aov", unit: "currency", points: [{ period: "2026-01", value: 10 }] } }],
]);

beforeAll(async () => {
  ws = await Workspace.open();
  book = new FactBook(ws, [avg], await loadCatalog(ws), "month", series);
});
afterAll(() => ws.close());

const code = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AnalysisError);
    return (e as AnalysisError).code;
  }
  return undefined;
};

describe("FactBook errors are typed (AGENTS.md §4)", () => {
  it("UNKNOWN_SERIES", async () => {
    expect(await code(book.point("nope", "2026-01"))).toBe("UNKNOWN_SERIES");
  });

  it("NO_VALUE: an average with no rows in a period is unknown, not 0", async () => {
    expect(await code(book.point("aov", "2026-02"))).toBe("NO_VALUE");
  });

  it("CALC_UNDEFINED", async () => {
    expect(await code(book.resolve(calcRef("missing"), new Map()))).toBe("CALC_UNDEFINED");
  });

  it("NO_VALUE: a derived number that isn't finite never becomes a fact", async () => {
    const ratio = { name: "share", label: "share", value: Number.NaN, unit: "percent" as const, fn: "contribution.v1", inputs: [] };
    expect(await code(book.calcs([ratio], "zero-total"))).toBe("NO_VALUE");
    expect(book.facts.some((f) => f.label === "zero-total:share")).toBe(false);
  });

  it("CALC_UNDEFINED: a calc name with no fact is an error, not an empty id", () => {
    expect(() => factOf(new Map([["a", "N1"]]), "b")).toThrowError(expect.objectContaining({ code: "CALC_UNDEFINED" }));
    expect(factOf(new Map([["a", "N1"]]), "a")).toBe("N1");
  });

  it("CIRCULAR_CALCS", async () => {
    const c = (name: string, dep: string) => ({ name, label: name, value: 1, unit: "count" as const, fn: "x", inputs: [calcRef(dep)] });
    expect(await code(book.calcs([c("a", "b"), c("b", "a")], "loop"))).toBe("CIRCULAR_CALCS");
  });
});
