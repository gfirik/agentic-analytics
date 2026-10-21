// Tool input schemas refuse what would silently go wrong (code-quality fix 11, retrieval row 2).
import { describe, expect, it } from "vitest";
import { Budget, buildTools, type ToolContext } from "../src/index.ts";

describe("search_documents input", () => {
  it("takes from/to as YYYY-MM-DD only: 'March 2026' or '2026-3-1' would match nothing as text", () => {
    // The schema is checked before a tool runs, so a context the tool never touches is enough here.
    const tools = buildTools(
      { found: { extracts: [], quarantined: [], questions: [], scenarios: [] } } as unknown as ToolContext,
      new Budget(5, 5),
    );
    const schema = (tools.search_documents as { inputSchema: { safeParse(v: unknown): { success: boolean } } }).inputSchema;
    expect(schema.safeParse({ query: "catalogue", from: "2026-06-01", to: "2026-06-30" }).success).toBe(true);
    for (const bad of ["March 2026", "2026-3-1", "06/01/2026"])
      expect(schema.safeParse({ query: "catalogue", from: bad }).success, bad).toBe(false);
  });
});
