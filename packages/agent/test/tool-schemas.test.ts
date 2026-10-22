// Tool input schemas refuse what would silently go wrong (code-quality fix 11, retrieval row 2).
import { describe, expect, it } from "vitest";
import { Budget, buildTools, type OpenQuestionDraft, relinkQuestions, type ToolContext } from "../src/index.ts";

describe("search_documents input", () => {
  it("takes from/to as YYYY-MM-DD only: 'March 2026' or '2026-3-1' would match nothing as text", () => {
    // The schema is checked before a tool runs, so a context the tool never touches is enough here.
    const tools = buildTools(
      { found: { extracts: [], quarantined: [], questions: [], scenarios: [] } } as unknown as ToolContext,
      new Budget(5, 5),
    );
    const schema = (tools.search_documents as { inputSchema: { safeParse(v: unknown): { success: boolean } } }).inputSchema;
    expect(schema.safeParse({ query: "catalogue", from: "2026-06-01", to: "2026-06-30" }).success).toBe(true);
    for (const bad of ["March 2026", "2026-3-1", "06/01/2026", "2026-13-45", "2026-02-30"])
      expect(schema.safeParse({ query: "catalogue", from: bad }).success, bad).toBe(false);
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
