// Arm A (accuracy.md §8.1–§8.2): the files as text cut by whole rows to the context window with the cut stated in the
// input, and its own model client: no response cache and its own call log, so the engine's cache is never touched.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { type CallRecord, estimateTokens, Router } from "@agentic-analytics/models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ARM_A_SYSTEM, armAPrompt, armAText, armModelClient, readSources, runArmA, type Sources } from "../src/index.ts";

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

let sources: Sources;
beforeAll(async () => {
  sources = await readSources(Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes })));
}, 60_000);

describe("arm A's input", () => {
  it("is complete when it fits, and says so", () => {
    const { text, cut } = armAText(sources, 10_000_000);
    expect(cut.complete).toBe(true);
    expect(cut.statement).toMatch(/complete/);
    // Every table and document is in the text: the orders table's 6,260 rows plus the header line.
    expect(cut.tables.map((t) => [t.table, t.shown, t.of])).toEqual([
      ["t_t1", 6260, 6260],
      ["t_t2", 6, 6],
      ["t_t3", 6, 6],
    ]);
    for (const d of sources.documents) expect(text).toContain(`=== document ${d.file} ===`);
  });

  it("is cut by whole rows to the budget, small tables kept whole, and the cut is stated in the prompt", () => {
    const { text, cut } = armAText(sources, 20_000);
    expect(estimateTokens(text)).toBeLessThanOrEqual(20_000);
    const [orders, m1, m2] = cut.tables;
    expect(orders?.shown).toBeGreaterThan(0);
    expect(orders?.shown).toBeLessThan(6260);
    expect([m1?.shown, m2?.shown]).toEqual([6, 6]);
    // Whole rows: the orders block has its header line and exactly `shown` row lines.
    const block = text.split("=== table t_t1")[1]?.split("=== table")[0] ?? "";
    expect(block.trim().split("\n").length).toBe(1 + 1 + (orders?.shown ?? 0)); // title, header, rows
    expect(cut.statement).toContain(`t_t1 (sales-2026.xlsx#Orders) shows rows 1–${orders?.shown} of 6260`);
    const { prompt } = armAPrompt(sources, { kind: "question", id: "G1", question: "What was revenue in April 2026?" }, 32_768);
    expect(prompt).toMatch(/The input is cut to fit the model's context window: t_t1 \(sales-2026\.xlsx#Orders\) shows rows 1–\d+ of 6260/);
    expect(estimateTokens(ARM_A_SYSTEM) + estimateTokens(prompt)).toBeLessThan(32_768);
  });
});

/** Answers every chat-completions request with one valid arm A answer, counting the requests. */
function stub(sent: { n: number }): typeof fetch {
  return (async () => {
    sent.n++;
    return Response.json({
      id: "cmpl-1",
      object: "chat.completion",
      created: 0,
      model: "stub",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: '{"answer":"It was 36,200.","member":null,"refused":false,"caveat":null}' },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
    });
  }) as typeof fetch;
}

/** Every file under `dir` with its size and modification time. */
function snapshot(dir: string): string[] {
  if (!existsSync(dir)) return ["(absent)"];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else out.push(`${p} ${s.size} ${s.mtimeMs}`);
    }
  };
  walk(dir);
  return out;
}

describe("arm A's model client", () => {
  const root = mkdtempSync(join(tmpdir(), "aa-ablation-cache-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("never reads or writes the engine's response cache, and logs its calls to its own log", async () => {
    // The engine's cache, as `aa eval` would find it (AA_MODEL_CACHE), with an entry in it; and the checkout's.
    const engineCache = join(root, "engine-cache");
    mkdirSync(engineCache, { recursive: true });
    writeFileSync(join(engineCache, "entry.json"), "{}");
    const checkoutCache = join(import.meta.dirname, "..", "..", ".cache");
    const before = [snapshot(engineCache), snapshot(checkoutCache)];
    const log: CallRecord[] = [];
    const sent = { n: 0 };
    const client = armModelClient("ollama:qwen3.5:9b", {
      env: { OLLAMA_BASE_URL: "http://ollama.test:11434", AA_MODEL_CACHE: engineCache },
      router: new Router(),
      log: (c) => log.push(c),
      fetch: stub(sent),
    });
    const task = { kind: "question" as const, id: "G1", question: "What was revenue in April 2026?" };
    const first = await runArmA(client, sources, task, 32_768);
    const second = await runArmA(client, sources, task, 32_768);
    expect(first.answer).toMatchObject({ answer: "It was 36,200." });
    expect(second.answer).toMatchObject({ answer: "It was 36,200." });
    // Both calls were live (no cache to replay from), and both are in the arm's own log.
    expect(sent.n).toBe(2);
    expect(log.map((c) => c.cached)).toEqual([false, false]);
    expect([snapshot(engineCache), snapshot(checkoutCache)]).toEqual(before);
    expect(readFileSync(join(engineCache, "entry.json"), "utf8")).toBe("{}");
  });
});
