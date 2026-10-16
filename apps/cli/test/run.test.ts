import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coffeePlanner } from "@agentic-analytics/core/testing";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { afterAll, describe, expect, it } from "vitest";
import { runCommand } from "../src/run.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));

describe("aa run", () => {
  it("prints each stage and a summary, and writes the draft", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-cli-"));
    dirs.push(dir);
    const lines: string[] = [];
    const code = await runCommand(
      { dir, files, options: { today: "2026-07-01", currency: "USD" } },
      { model: coffeePlanner(), embedder: hashEmbedder(), out: (l) => lines.push(l) },
    );
    expect(code).toBe(0);
    expect(lines).toContain("▸ EXPLAIN");
    expect(lines.some((l) => /^✓ DECIDE \(\d+ ms\)$/.test(l))).toBe(true);
    expect(lines).toContain("  F1 Revenue fell after March, driven by wholesale");
    expect(lines).toContain(`draft (unverified): ${join(dir, "report.draft.json")}`);
  }, 180_000);

  it("on a failed stage, prints how to resume instead of a stack trace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-cli-"));
    dirs.push(dir);
    const lines: string[] = [];
    const down = {
      generateObject: async () => {
        throw new Error("Cannot connect to API");
      },
      generateWithTools: async () => {
        throw new Error("Cannot connect to API");
      },
      embed: async () => [],
    };
    const code = await runCommand(
      { dir, files, options: { today: "2026-07-01" } },
      { model: down, embedder: hashEmbedder(), out: (l) => lines.push(l) },
    );
    expect(code).toBe(1);
    expect(lines).toContain("✗ EXPLAIN failed: STAGE_FAILED: Cannot connect to API");
    expect(lines).toContain(`  aa run --resume ${dir}`);
  }, 180_000);
});
