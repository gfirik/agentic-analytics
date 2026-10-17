// The Learn section (docs/DOCS-SITE.md §1): its data is real engine output and can't drift, it is the same run as the
// README GIF and the landing page, its hand-checkable numbers are right, and every repo link and glossary link on
// its pages points at something that exists.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEARN_JSON, learnJson, recordLearn } from "../../apps/docs/scripts/learn-data.ts";
import { PIPELINE_JSON } from "../../apps/docs/scripts/pipeline-data.ts";
import type { LearnData } from "../../apps/docs/src/components/learn/types.ts";
import type { PipelineData } from "../../apps/docs/src/components/pipeline-scene.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const LEARN = join(ROOT, "apps", "docs", "src", "content", "docs", "learn");
const data = JSON.parse(readFileSync(LEARN_JSON, "utf8")) as LearnData;
const fact = (id: string) => {
  const f = data.facts[id];
  if (!f) throw new Error(`no fact ${id}`);
  return f;
};

/** Floats from DuckDB sums may differ in the last bits between machines; V2's tolerance (1e-9 relative) applies. */
const stable = (json: string) =>
  JSON.stringify(JSON.parse(json, (_k, v: unknown) => (typeof v === "number" ? Number(v.toPrecision(9)) : v)));

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(mdx?|astro|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}
const pages = files(LEARN);
const sources = [...pages, ...files(join(ROOT, "apps", "docs", "src", "components", "learn"))];

describe("learn.json (from real runs)", () => {
  it("matches a fresh recording (regenerate with `tsx apps/docs/scripts/learn-data.ts --write`)", async () => {
    const fresh = await recordLearn();
    expect(stable(learnJson(fresh))).toEqual(stable(JSON.stringify(data)));
  }, 400_000);

  it("is the same run as the README GIF and the landing page (pipeline.json)", () => {
    const hero = JSON.parse(readFileSync(PIPELINE_JSON, "utf8")) as PipelineData;
    expect(data.analysis.change.pct).toBe(hero.change.pct.id);
    expect(fact(data.analysis.change.pct).value).toBeCloseTo(hero.change.pct.value, 9);
    expect([data.analysis.change.before, data.analysis.change.after]).toEqual([hero.change.from.id, hero.change.to.id]);
    expect(data.verifier.summary.numbers_checked).toBe(hero.verification.numbers_checked);
    expect(data.verifier.checks.map((c) => [c.check, c.run, c.failed])).toEqual(hero.checks.map((c) => [c.check, c.run, c.failed]));
    expect([data.report.action.id, data.report.action.low, data.report.action.high]).toEqual([
      hero.action.id,
      hero.action.low.id,
      hero.action.high.id,
    ]);
    expect(data.run.stages).toEqual(hero.stages);
  });

  it("holds the hand-computed numbers", () => {
    // (36,200 − 44,100) / 44,100 = −17.9138…%
    expect(fact(data.analysis.change.pct).value).toBeCloseTo(((36_200 - 44_100) / 44_100) * 100, 9);
    // Wholesale −8,500 of a −7,900 change = 107.59…%
    const w = data.analysis.channel.find((c) => c.member === "wholesale");
    expect(fact(w?.share ?? "").value).toBeCloseTo((8_500 / 7_900) * 100, 6);
    // The channel deltas and the PVM effects add up to the change.
    const sum = (ids: string[]) => ids.reduce((a, id) => a + fact(id).value, 0);
    expect(sum(data.analysis.channel.map((c) => c.delta))).toBeCloseTo(-7_900, 6);
    const p = data.analysis.pvm;
    expect(sum([p.volume, p.mix, p.price])).toBeCloseTo(-7_900, 6);
    // RRF with k = 60: the email is #3 in both lanes, so 2 / 63.
    const email = data.retrieval.hits.find((h) => h.file === "email-0412.eml");
    expect(email?.rrf).toBeCloseTo(1 / (60 + (email?.bm25 ?? 0)) + 1 / (60 + (email?.vector ?? 0)), 12);
    // The revenue series is the answer key's integer-cent ledger (evals/datasets/coffee-roaster-v1/answers.yaml).
    expect(data.metrics.revenue.series.map((s) => Math.round(fact(s.fact).value))).toEqual([
      41_200, 42_900, 44_100, 36_200, 35_800, 37_000,
    ]);
  });

  it("records what each page says it shows", () => {
    expect(data.web.removed.map((r) => r.kind).sort()).toEqual(["name", "number"]);
    expect(data.web.results.map((r) => r.outcome)).toEqual(["kept", "quarantined", "refused"]);
    expect(data.security.injectionRun).toMatchObject({ sameFacts: true, phraseInReport: false });
    expect(data.security.screen.filter((s) => s.flagged).map((s) => s.source)).toEqual(["email-supplier.eml"]);
    expect(data.router.calls.map((c) => [c.endpoint, c.status, c.cached])[0]).toEqual(["groq", 429, false]);
    expect(data.tutorials.evidence.without.claims.some((c) => c.grade === "document_supported")).toBe(false);
    expect(data.tutorials.evidence.with.claims.some((c) => c.grade === "document_supported")).toBe(true);
    const t = data.transcripts;
    expect(t.explainPct?.lines.join("\n")).toContain("change_pct");
    expect(t.explainSql?.lines.join("\n")).toContain("revenue_2026-04");
    expect(t.review?.lines).toContain("Metric refund_rate? [a]ccept / [e]dit / [d]rop: d");
    expect(t.eval?.lines.filter((l) => / pass: /.test(l)).length).toBeGreaterThan(0);
    expect(t.eval?.lines.some((l) => / FAIL: /.test(l))).toBe(false);
  });

  it("carries no keys, account ids or home paths", () => {
    const text = readFileSync(LEARN_JSON, "utf8");
    expect(text).not.toMatch(/gsk_|sk-[A-Za-z0-9]{8}|csk-|Bearer /);
    expect(text).not.toMatch(/\/home\/|\/Users\/|\/tmp\/aa-/);
  });
});

describe("Learn pages", () => {
  const all = sources.map((f) => readFileSync(f, "utf8")).join("\n");

  it("link only to files that exist in the repository", () => {
    const links = [...all.matchAll(/https:\/\/github\.com\/gfirik\/agentic-analytics\/(?:blob|tree)\/main\/([^)\s"'#]+)/g)].map(
      (m) => m[1] as string,
    );
    expect(links.length).toBeGreaterThan(40);
    expect(links.filter((p) => !existsSync(join(ROOT, p)))).toEqual([]);
  });

  it("link only to glossary entries that exist", () => {
    const glossary = readFileSync(join(LEARN, "glossary.mdx"), "utf8");
    const slug = (h: string) =>
      h
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .trim()
        .replace(/\s+/g, "-");
    const anchors = new Set([...glossary.matchAll(/^### (.+)$/gm)].map((m) => slug(m[1] as string)));
    const used = [...all.matchAll(/glossary\/#([a-z0-9-]+)/g)].map((m) => m[1] as string);
    expect(used.length).toBeGreaterThan(20);
    expect([...new Set(used)].filter((a) => !anchors.has(a))).toEqual([]);
  });

  it("has the overview, ten stage guides, five tutorials and the glossary", () => {
    const rel = pages.map((p) => p.slice(LEARN.length + 1)).sort();
    expect(rel.filter((p) => p.startsWith("stages/"))).toHaveLength(10);
    expect(rel.filter((p) => p.startsWith("tutorials/"))).toHaveLength(5);
    expect(rel).toEqual(expect.arrayContaining(["index.mdx", "glossary.mdx"]));
  });
});
