// The fence around the ablation (accuracy.md §8.2): arms A and B break AGENTS.md §2.5 and §2.6 on purpose, so they live
// in evals/ablation only. Nothing under packages/ or apps/ imports this package or names its folder, and run_sql (the
// one model-written-SQL tool) is defined nowhere under packages/, packages/agent/tools included. A static check, not a
// sandbox: the sandbox is src/sandbox.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SKIP = new Set(["node_modules", "dist", ".astro", ".turbo", "coverage", "test-results", "playwright-report"]);
// Code and package manifests: what can import or define something (docs pages may name the folder).
const TEXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|json|astro)$/;

function walk(d: string, out: string[]): string[] {
  for (const name of readdirSync(d)) {
    if (SKIP.has(name)) continue;
    const p = join(d, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (TEXT.test(name)) out.push(p);
  }
  return out;
}
const rel = (f: string) => relative(ROOT, f).split("\\").join("/");

describe("the ablation stays in evals/", () => {
  const files = [...walk(join(ROOT, "packages"), []), ...walk(join(ROOT, "apps"), [])];

  it("walks the engine and the apps", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("nothing under packages/ or apps/ imports evals/ablation", () => {
    const IMPORTS = /@agentic-analytics\/eval-ablation|evals[\\/]ablation|["'`]evals["'`]\s*,\s*["'`]ablation["'`]/;
    expect(files.filter((f) => IMPORTS.test(readFileSync(f, "utf8"))).map(rel)).toEqual([]);
  });

  it("run_sql is defined nowhere under packages/ (not in packages/agent/tools)", () => {
    const pkgs = files.filter((f) => rel(f).startsWith("packages/"));
    expect(pkgs.filter((f) => /\brun_sql\b/.test(readFileSync(f, "utf8"))).map(rel)).toEqual([]);
    // The allow-list stays true: run_sql really is here.
    expect(readFileSync(join(import.meta.dirname, "..", "src", "arms.ts"), "utf8")).toMatch(/\brun_sql\b/);
  });
});
