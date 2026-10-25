// Tool input schemas refuse what would silently go wrong (code-quality fix 11, retrieval row 2).
import { describe, expect, it } from "vitest";
import { Budget, buildTools, type OpenQuestionDraft, relinkQuestions, type ToolContext } from "../src/index.ts";

describe("search_documents input", () => {
  // The schema is checked before a tool runs, so a context the tool never touches is enough for these.
  const tools = buildTools(
    { found: { extracts: [], quarantined: [], questions: [], scenarios: [] } } as unknown as ToolContext,
    new Budget(50, 50),
  );
  const search = tools.search_documents as {
    inputSchema: { safeParse(v: unknown): { success: boolean } };
    execute(i: unknown): Promise<Record<string, unknown>>;
  };

  it("validates every form a real planner sends, so the call is never a schema failure that aborts the stage", () => {
    for (const v of ["2026-06-01", "", "2020-03", "2020", "March 2026", "2026-3-1", "06/01/2026", "2026-13-45"])
      expect(search.inputSchema.safeParse({ query: "catalogue", from: v, to: v }).success, v).toBe(true);
  });

  it("refuses just that call, with a readable tool error, when a date cannot be read", async () => {
    for (const bad of ["March 2026", "2026-3-1", "06/01/2026", "2026-13-45", "2026-02-30", "2020-13"]) {
      const out = await search.execute({ query: "catalogue", from: bad });
      expect(String(out.error), bad).toContain("YYYY-MM-DD");
    }
    expect((await search.execute({ query: "catalogue", from: "2020-05", to: "2020-04" })).error).toContain("after");
  });
});

describe("relinkQuestions", () => {
  it("follows a renumbered finding, and drops the link of a dropped one", () => {
    // F1 was dropped (its only source was quarantined): old F2 → F1, old F3 → F2.
    const qs: OpenQuestionDraft[] = [
      { question: "a?", why_it_matters: "x", finding: "F2" },
      { question: "b?", why_it_matters: "x", finding: "F1" },
      { question: "c?", why_it_matters: "x" },
      { question: "d?", why_it_matters: "x", finding: "F3" },
    ];
    relinkQuestions(qs, ["F2", "F3"]);
    expect(qs.map((q) => q.finding)).toEqual(["F1", undefined, undefined, "F2"]);
    expect("finding" in (qs[1] as object)).toBe(false);
  });
});
