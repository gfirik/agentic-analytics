// A nightly run carried over two passes (docs/EVALS.md §4, scripts/eval-daily.sh): on 2026-10-19 Groq's free daily
// quota for the planner (200k tokens) stopped 9 of the 30 businesses. The next night resumes that result and runs only
// the unfinished jobs; a job that finished on either night counts as finished, and the run is partial only when jobs
// are still unfinished after its last pass. No network: the scripted baseline model, with a fake quota.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ModelClient, ModelError } from "@agentic-analytics/models";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { describe, expect, it } from "vitest";
import {
  baselineModel,
  configuredName,
  evalCommand,
  mergeRoutes,
  planResume,
  resultsMarkdown,
  resumeResult,
  runStatus,
  type SuiteResult,
  summarize,
} from "../src/index.ts";

const score = (dataset: string, completed: boolean, route = "openai-compatible:groq:qwen/qwen3.8-27b") =>
  ({
    dataset,
    completed,
    ...(completed ? {} : { error: "RATE_LIMITED: every route is rate-limited" }),
    planted: [{ id: "P1", detected: completed }],
    distractorsReported: [],
    qualityFound: [],
    distractors: 0,
    quality: 0,
    findings: completed ? 1 : 0,
    seconds: 10,
    tokens: { input: 100, output: 10 },
    routes: [{ role: "planner", route, calls: 2, cached: 0, failed: completed ? 0 : 1 }],
  }) as unknown as SuiteResult["scores"][number];

const NAME = "openai-compatible:groq:qwen/qwen3.8-27b planner (small-model mode)";
const result = (date: string, scores: SuiteResult["scores"], passes?: SuiteResult["passes"]): SuiteResult => ({
  suite: "full",
  model: NAME,
  date,
  datasets: scores.length,
  scores,
  bars: summarize(scores),
  routes: mergeRoutes(scores.flatMap((s) => s.routes ?? [])),
  seconds: 1,
  tokens: { input: 0, output: 0 },
  ...(passes ? { passes } : {}),
});
const IDS = ["a-v1", "b-v1", "c-v1"];
const plan = (prev: SuiteResult | undefined, today = "2026-10-20", passes = 2) =>
  planResume(prev, { suite: "full", modelName: NAME, ids: IDS, passes, today });

describe("runStatus", () => {
  it("is partial only when jobs are unfinished and no pass is left", () => {
    expect(runStatus(30, 30)).toBe("complete");
    expect(runStatus(21, 30)).toBe("partial");
    expect(runStatus(21, 30, { dates: ["2026-10-19"], of: 2 })).toBe("resuming");
    expect(runStatus(29, 30, { dates: ["2026-10-19", "2026-10-20"], of: 2 })).toBe("partial");
    expect(runStatus(30, 30, { dates: ["2026-10-19", "2026-10-20"], of: 2 })).toBe("complete");
  });
});

describe("planResume", () => {
  const night1 = result("2026-10-19", [score("a-v1", true), score("b-v1", false), score("c-v1", false)], { dates: ["2026-10-19"], of: 2 });

  it("resumes last night's unfinished jobs only", () => {
    const p = plan(night1);
    expect(p.from).toBe(night1);
    expect(p.run).toEqual(["b-v1", "c-v1"]);
    expect(p.passes).toEqual({ dates: ["2026-10-19", "2026-10-20"], of: 2 });
  });

  it("starts afresh with no earlier result, a finished one, or one whose passes are used up", () => {
    const fresh = { run: IDS, passes: { dates: ["2026-10-20"], of: 2 } };
    expect(plan(undefined)).toEqual(fresh);
    expect(
      plan(
        result(
          "2026-10-19",
          IDS.map((id) => score(id, true)),
          { dates: ["2026-10-19"], of: 2 },
        ),
      ),
    ).toEqual(fresh);
    const closed = result("2026-10-19", night1.scores, { dates: ["2026-10-18", "2026-10-19"], of: 2 });
    expect(plan(closed)).toEqual(fresh);
  });

  it("starts afresh when the earlier result is older than a night, names another model, or covers other datasets", () => {
    expect(plan(night1, "2026-10-22").from).toBeUndefined();
    expect(plan({ ...night1, model: "configured (small-model mode)" }).from).toBeUndefined();
    expect(plan({ ...night1, scores: night1.scores.slice(0, 2) }).from).toBeUndefined();
  });

  it("counts a one-pass result (written before --passes) as its first pass", () => {
    const old = result("2026-10-19", night1.scores);
    expect(plan(old).run).toEqual(["b-v1", "c-v1"]);
  });
});

describe("resumeResult", () => {
  it("keeps the first night's finished jobs and counts a job finished on the second night as finished", () => {
    const night1 = result("2026-10-19", [score("a-v1", true), score("b-v1", false), score("c-v1", false)], {
      dates: ["2026-10-19"],
      of: 2,
    });
    const night2 = result("2026-10-20", [score("b-v1", true), score("c-v1", true)]);
    const passes = { dates: ["2026-10-19", "2026-10-20"], of: 2 };
    const r = resumeResult(night1, night2, passes, IDS);
    expect(r.scores.map((s) => [s.dataset, s.completed])).toEqual([
      ["a-v1", true],
      ["b-v1", true],
      ["c-v1", true],
    ]);
    expect(r.date).toBe("2026-10-20");
    expect(r.datasets).toBe(3);
    expect(r.passes).toEqual(passes);
    expect(r.bars.find((b) => b.metric === "Jobs completed")?.value).toBe(1);
    // Calls are summed over the jobs kept: the first night's failed attempts at b and c are not counted twice.
    expect(r.routes).toEqual([{ role: "planner", route: "openai-compatible:groq:qwen/qwen3.8-27b", calls: 6, cached: 0, failed: 0 }]);
    expect(resultsMarkdown(r)).toContain("Passes: 2026-10-19, 2026-10-20 (2 of up to 2; every job finished).");
  });

  it("labels a run partial after its last pass, and resuming before it", () => {
    const night1 = result("2026-10-19", [score("a-v1", true), score("b-v1", false), score("c-v1", false)], {
      dates: ["2026-10-19"],
      of: 2,
    });
    expect(resultsMarkdown(night1)).toContain("n/a (resumes next pass)");
    const night2 = result("2026-10-20", [score("b-v1", true), score("c-v1", false)]);
    const md = resultsMarkdown(resumeResult(night1, night2, { dates: ["2026-10-19", "2026-10-20"], of: 2 }, IDS));
    expect(md).toContain("partial: jobs still unfinished after the last pass");
    expect(md).toContain("n/a (partial run)");
  });
});

describe("configuredName", () => {
  it("names a configured run after its routes", () => {
    const groq = (model: string) => ({ provider: "openai-compatible", endpoint: "groq", model });
    expect(
      configuredName({ planner: groq("qwen/qwen3.8-27b"), extractor: groq("openai/gpt-oss-120b"), judge: groq("openai/gpt-oss-20b") }),
    ).toBe("openai-compatible:groq:qwen/qwen3.8-27b planner, gpt-oss-120b extractor, gpt-oss-20b judge");
    expect(
      configuredName({
        planner: groq("qwen/qwen3.8-27b"),
        extractor: { provider: "ollama", model: "qwen3.5:9b" },
        judge: groq("openai/gpt-oss-20b"),
      }),
    ).toBe("openai-compatible:groq:qwen/qwen3.8-27b planner, ollama:qwen3.5:9b extractor, gpt-oss-20b judge");
  });
});

/**
 * The scripted baseline model behind a daily quota: after `budget` calls every call fails as a free tier's does once
 * its tokens per day are spent. One quota per night, shared by every job of the night.
 */
function quotaModel(budget: number): () => ModelClient {
  let used = 0;
  const spend = () => {
    if (++used > budget) throw new ModelError("RATE_LIMITED", "every route is rate-limited: fake:quota for 1964 s");
  };
  return () => {
    const m = baselineModel();
    return {
      generateObject: async (a) => {
        spend();
        return m.generateObject(a);
      },
      generateWithTools: async (a) => {
        spend();
        return m.generateWithTools(a);
      },
      embed: (t) => m.embed(t),
    };
  };
}

describe("evalCommand --passes 2", () => {
  const night = async (dir: string, date: string, budget: number, lines: string[]) =>
    evalCommand(
      { suite: "smoke", model: "fake-quota", passes: 2, resultsDir: join(dir, "results"), resultsPage: join(dir, "RESULTS.md") },
      {
        embedder: hashEmbedder(),
        print: (l) => lines.push(l),
        modelFor: (() => {
          const make = quotaModel(budget);
          return () => make();
        })(),
        now: () => new Date(`${date}T22:00:00Z`),
      },
    );

  it("resumes a night the quota cut short and publishes one complete run", { timeout: 120_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-eval-passes-"));
    // Night 1: enough quota for the first business only (the baseline makes 43 calls on it, 53 on the next), so the
    // other two stop.
    const lines1: string[] = [];
    const n1 = await night(dir, "2026-10-19", 60, lines1);
    const done1 = n1.scores.filter((s) => s.completed).map((s) => s.dataset);
    expect(done1.length).toBeGreaterThan(0);
    expect(done1.length).toBeLessThan(3);
    expect(n1.passes).toEqual({ dates: ["2026-10-19"], of: 2 });
    expect(n1.scores.find((s) => !s.completed)?.error).toMatch(/RATE_LIMITED/);
    expect(lines1.find((l) => l.startsWith("combined: "))).toMatch(
      /^combined: \d of 3 jobs finished over 1 of up to 2 passes .*the next pass runs the rest$/,
    );
    expect(readdirSync(join(dir, "results"))).toEqual(["2026-10-19-fake-quota-smoke.json"]);
    expect(readFileSync(join(dir, "RESULTS.md"), "utf8")).toContain("n/a (resumes next pass)");

    // Night 2: a fresh quota; only the unfinished businesses run.
    const lines2: string[] = [];
    const n2 = await night(dir, "2026-10-20", 1000, lines2);
    expect(lines2[0]).toMatch(/^resuming the 2026-10-19 pass \(2026-10-19-fake-quota-smoke\.json\)/);
    const ran = lines2.filter((l) => /^\[\d+\/\d+\]/.test(l));
    expect(ran).toHaveLength(3 - done1.length);
    expect(ran.some((l) => done1.some((id) => l.includes(id)))).toBe(false);
    expect(n2.scores.every((s) => s.completed)).toBe(true);
    expect(n2.datasets).toBe(3);
    expect(n2.passes).toEqual({ dates: ["2026-10-19", "2026-10-20"], of: 2 });
    // The first night's finished scores are carried over unchanged.
    for (const id of done1) expect(n2.scores.find((s) => s.dataset === id)).toEqual(n1.scores.find((s) => s.dataset === id));
    // One file, one row: the combined result replaces the first night's.
    expect(readdirSync(join(dir, "results"))).toEqual(["2026-10-20-fake-quota-smoke.json"]);
    const page = readFileSync(join(dir, "RESULTS.md"), "utf8");
    const row = page.slice(page.indexOf("### fake-quota"));
    expect(row).not.toMatch(/partial|resumes next pass|n\/a/);
    expect(page).toContain("Passes: 2026-10-19, 2026-10-20 (2 of up to 2; every job finished).");

    // Night 3: the run is closed, so a new one starts with every business.
    const lines3: string[] = [];
    const n3 = await night(dir, "2026-10-21", 1000, lines3);
    expect(lines3.filter((l) => /^\[\d+\/\d+\]/.test(l))).toHaveLength(3);
    expect(n3.passes).toEqual({ dates: ["2026-10-21"], of: 2 });
  });

  it("refuses --passes with --only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-eval-passes-"));
    await expect(
      evalCommand(
        { suite: "smoke", model: "baseline", passes: 2, only: ["saas-v2"], resultsDir: join(dir, "r") },
        { embedder: hashEmbedder(), print: () => {} },
      ),
    ).rejects.toThrow(/--passes goes with a whole suite/);
  });

  it("writes no passes field for a one-pass run (results files keep their shape)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-eval-passes-"));
    const r = await evalCommand(
      { suite: "smoke", model: "baseline", only: ["saas-v2"], resultsDir: join(dir, "r") },
      { embedder: hashEmbedder(), print: () => {} },
    );
    expect("passes" in r).toBe(false);
  });
});
