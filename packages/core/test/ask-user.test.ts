// An open question links to the finding it was asked about (code-quality fix 11, agent row 4): a question the
// planner records while investigating the second finding says "would change: F2", not F1.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import type { ModelClient } from "@agentic-analytics/models";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { afterAll, describe, expect, it } from "vitest";
import { runJob } from "../src/index.ts";
import { coffeePlanner } from "../testing/coffee-planner.ts";

const dir = mkdtempSync(join(tmpdir(), "aa-ask-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("ask_user", () => {
  it("links the question to the finding being investigated", async () => {
    const planner = coffeePlanner();
    let finding = 0;
    const model: ModelClient = {
      generateObject: (a) => planner.generateObject(a),
      embed: (t) => planner.embed(t),
      async generateWithTools(a) {
        finding++;
        // While investigating the second finding, the planner asks the user something.
        if (finding === 2)
          await (a.tools.ask_user as { execute(i: unknown): Promise<unknown> }).execute({
            question: "Did a key wholesale account pause its orders?",
            why_it_matters: "It would explain the drop without a price effect.",
          });
        return planner.generateWithTools(a);
      },
    };
    const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
    const out = await runJob({ dir, files, options: { today: "2026-07-01", currency: "USD" } }, { model, embedder: hashEmbedder() });
    expect(finding).toBeGreaterThanOrEqual(2);
    const q = out.report.open_questions.find((x) => x.question === "Did a key wholesale account pause its orders?");
    expect(q?.would_change).toEqual(["F2"]);
  }, 180_000);
});

describe("search_documents dates", () => {
  it("runs a job whose planner sends from: '' and to: '2020-04' (the dates gpt-oss-20b sent)", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "aa-dates-"));
    const planner = coffeePlanner({ searchDates: { from: "", to: "2020-04" } });
    const searches: { input: unknown; output?: unknown; error?: string }[] = [];
    const model: ModelClient = {
      generateObject: (a) => planner.generateObject(a),
      embed: (t) => planner.embed(t),
      async generateWithTools(a) {
        const r = await planner.generateWithTools(a);
        for (const s of r.steps) for (const c of s.toolCalls) if (c.toolName === "search_documents") searches.push(c);
        return r;
      },
    };
    const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
    const out = await runJob({ dir: dir2, files, options: { today: "2026-07-01", currency: "USD" } }, { model, embedder: hashEmbedder() });
    expect(searches.length).toBeGreaterThan(0);
    for (const s of searches) {
      expect(s.error).toBeUndefined();
      expect(s.output).not.toHaveProperty("error");
    }
    expect(out.report.findings.length).toBeGreaterThan(0);
    rmSync(dir2, { recursive: true, force: true });
  }, 180_000);
});
