// The held-out generated set stays apart from development (docs/specs/accuracy.md §9). Release runs read it through
// evals/runner (`aa eval --suite heldout`); the engine never does. Like the golden set's held-out guard, a static
// check: nothing under packages/ imports the dataset generator, and no file under packages/ or apps/ names the
// held-out set's API, its answer-key folder or manifest, or (in code) its archetypes and businesses, so no rule can
// be keyed to them. The CLI picks the suite by its name ("heldout") and needs no allow-list entry.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { generatedDatasets, HELDOUT_SMOKE, heldoutDatasets } from "@agentic-analytics/eval-generator";
import { describe, expect, it } from "vitest";
import { SMOKE_DATASETS, suiteDatasets } from "../src/index.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SKIP = new Set(["node_modules", "dist", ".astro", ".turbo", "coverage", "test-results", "playwright-report"]);
const TEXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|json|ya?ml|md|mdx|astro|sql|html|css)$/;
const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|json|sql|astro)$/;

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

/** The held-out API (src/heldout.ts) and where its keys and hashes live. */
const API = /\b(heldoutDatasets|HELDOUT_ARCHETYPES|HELDOUT_SMOKE|HELDOUT_GENERATOR_VERSION|allGeneratedDatasets)\b/;
const PATHS =
  /datasets[\\/]heldout|heldout-manifest|build-heldout|generator[\\/]src[\\/]heldout|["'`]datasets["'`]\s*,\s*["'`]heldout["'`]/;
/** The new archetypes and their businesses: a rule naming them would be tuned on the held-out set. */
const NAMES = /\b(tool_hire|car_wash)\b|Summit Tool|Clearwater Car Wash/;

describe("held-out generated set (accuracy.md §9)", () => {
  const packages = walk(join(ROOT, "packages"), []);
  const apps = walk(join(ROOT, "apps"), []);

  it("nothing under packages/ imports the dataset generator", () => {
    expect(packages.length).toBeGreaterThan(50);
    expect(packages.filter((f) => readFileSync(f, "utf8").includes("@agentic-analytics/eval-generator")).map(rel)).toEqual([]);
  });

  it("no file under packages/ or apps/ names the held-out API, answer keys or manifest", () => {
    expect(apps.length).toBeGreaterThan(20);
    expect([...packages, ...apps].filter((f) => API.test(readFileSync(f, "utf8")) || PATHS.test(readFileSync(f, "utf8"))).map(rel)).toEqual(
      [],
    );
  });

  it("no code under packages/ or apps/ names the held-out archetypes or businesses", () => {
    expect([...packages, ...apps].filter((f) => CODE.test(f) && NAMES.test(readFileSync(f, "utf8"))).map(rel)).toEqual([]);
  });

  it("only the heldout suite runs the set, and the smoke suite carries exactly one of it", { timeout: 120_000 }, () => {
    const dev = generatedDatasets();
    const heldout = heldoutDatasets();
    const pool = [...dev, ...heldout];
    const held = new Set(heldout.map((d) => d.id));
    expect(suiteDatasets("full", pool).map((d) => d.id)).toEqual(dev.map((d) => d.id));
    expect(suiteDatasets("heldout", pool).map((d) => d.id)).toEqual([...held]);
    const smoke = suiteDatasets("smoke", pool).map((d) => d.id);
    expect([...smoke].sort()).toEqual([...SMOKE_DATASETS].sort());
    expect(smoke.filter((id) => held.has(id))).toEqual([HELDOUT_SMOKE]);
    // The default pools: full is the 30 alone; smoke draws on both.
    expect(suiteDatasets("full").filter((d) => held.has(d.id))).toEqual([]);
    expect(suiteDatasets("smoke").map((d) => d.id)).toEqual(smoke);
  });
});
