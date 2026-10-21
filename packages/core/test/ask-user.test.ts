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
