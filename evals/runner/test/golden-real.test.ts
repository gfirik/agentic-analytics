// The real datasets' golden sets (docs/specs/accuracy.md §4): every file parses and is well formed; with the data
// fetched (`bun run eval:real:fetch`), each item's SQL on the raw derived file returns its expected value and the dev
// split runs end to end with the baseline. CI has no data (it is never committed), so those parts are skipped there;
// the runner itself is covered in CI on the example workbook. Also the guard: nothing under packages/ or apps/ reads
// the held-out file.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type ModelClient, ModelError } from "@agentic-analytics/models";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { Workspace } from "@agentic-analytics/store";
import { describe, expect, it } from "vitest";
import {
  baselineModel,
  GOLDEN_DIR,
  type GoldenSplit,
  goldenDatasets,
  goldenEvalCommand,
  goldenFile,
  loadGoldenSet,
  runGoldenSet,
} from "../src/index.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const REAL = join(ROOT, "evals", "real");
const DATA = join(REAL, "data");
const ANSWERS = join(REAL, "answers");
const FILES: Record<string, string> = {
  "online-retail-ii": "online_retail_II.sample10.csv",
  "nz-card-spend": "nz-card-spend-by-industry.csv",
  "hotel-bookings": "hotel-bookings.csv",
};
const DATASETS = Object.keys(FILES);
const SPLITS: GoldenSplit[] = ["dev", "heldout"];
const hasData = (d: string) => existsSync(join(DATA, FILES[d] as string));

describe("the real datasets' golden sets", () => {
  it("each file parses, holds only its own split, and every answerable item has its SQL and columns", () => {
    for (const dataset of DATASETS) {
      const all = SPLITS.flatMap((split) => loadGoldenSet(GOLDEN_DIR, dataset, split).items);
      // About 10 items per dataset, about 20% traps and 30% held-out, at least one of each (m14.md "Golden-set review").
      expect(all.length, dataset).toBeGreaterThanOrEqual(9);
      expect(all.filter((i) => i.kind === "trap").length, dataset).toBeGreaterThanOrEqual(1);
      expect(all.filter((i) => i.split === "heldout").length, dataset).toBeGreaterThanOrEqual(2);
      // Ids are unique across both files, so a result line names one item.
      expect(new Set(all.map((i) => i.id)).size, dataset).toBe(all.length);
      for (const i of all) {
        if (i.kind === "trap") continue;
        expect(i.sql, `${dataset} ${i.id}`).toMatch(/read_csv\('FILE'/);
        expect(i.columns.length, `${dataset} ${i.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("golden v1 runs on the pinned datasets only: EIA-861M's draft (no file pinned yet) is never loaded", () => {
    for (const split of SPLITS) expect(goldenDatasets(GOLDEN_DIR, ANSWERS, split).sort(), split).toEqual([...DATASETS].sort());
    expect(existsSync(join(GOLDEN_DIR, "eia-861m", "draft.yaml"))).toBe(true);
    for (const split of SPLITS) expect(existsSync(goldenFile(GOLDEN_DIR, "eia-861m", split)), split).toBe(false);
  });

  it.skipIf(!DATASETS.every(hasData))(
    "each item's SQL on the raw derived file returns its expected value, and its columns are the file's (needs eval:real:fetch)",
    async () => {
      const ws = await Workspace.open(":memory:");
      try {
        for (const dataset of DATASETS) {
          const file = join(DATA, FILES[dataset] as string);
          const header = (
            await ws.all<{ column_name: string }>({ text: `DESCRIBE SELECT * FROM read_csv('${file}', all_varchar = true)`, params: [] })
          ).map((r) => r.column_name);
          for (const split of SPLITS)
            for (const item of loadGoldenSet(GOLDEN_DIR, dataset, split).items) {
              for (const c of item.columns) expect(header, `${dataset} ${item.id} column ${c}`).toContain(c);
              if (item.kind === "trap" || !item.sql) continue;
              const row = await ws.one<Record<string, unknown>>({ text: item.sql.replaceAll("FILE", file), params: [] });
              const got = Object.values(row ?? {})[0];
              if (item.kind === "numeric") expect(Number(got), `${dataset} ${item.id}`).toBeCloseTo(item.expected, 6);
              else expect(String(got), `${dataset} ${item.id}`).toBe(item.expected);
            }
        }
      } finally {
        ws.close();
      }
    },
  );

  it.skipIf(!DATASETS.every(hasData))(
    "the dev split runs with the baseline: the jobs complete and every fact item equals its SQL (needs eval:real:fetch)",
    async () => {
      for (const dataset of DATASETS) {
        const r = await runGoldenSet({
          dataset,
          split: "dev",
          model: () => baselineModel(),
          modelName: "baseline",
          embedder: hashEmbedder(),
          dataDir: DATA,
          answersDir: ANSWERS,
        });
        expect(r.completed, dataset).toBe(true);
        expect(
          r.items.filter((i) => i.source === "fact" && !i.pass).map((i) => `${i.id}: ${i.got}`),
          dataset,
        ).toEqual([]);
        // The driver items, pinned so a change shows: NZ's April 2020 change carries its drivers; retail's December
        // 2010 orders finding is an anomaly.v1 finding, which attaches none (a known engine gap, STATE).
        const drivers = Object.fromEntries(r.items.filter((i) => i.source === "driver").map((i) => [i.id, i]));
        if (dataset === "nz-card-spend") expect(drivers.G3?.pass, "nz G3").toBe(true);
        if (dataset === "online-retail-ii") expect(drivers.G7?.got, "retail G7").toMatch(/no driver/);
        // The scripted baseline answers no follow-up question: its ask items are misses, never n/a.
        expect(
          r.items.filter((i) => i.source === "ask").every((i) => !i.pass && i.got.startsWith("no answer")),
          dataset,
        ).toBe(true);
      }
    },
    300_000,
  );
});

describe("the golden runner (CI, on the example workbook)", () => {
  const EXAMPLES = join(ROOT, "examples");
  const dir = () => mkdtempSync(join(tmpdir(), "aa-golden-run-"));
  const write = (goldenDir: string, dataset: string, split: GoldenSplit, text: string) => {
    mkdirSync(join(goldenDir, dataset), { recursive: true });
    writeFileSync(goldenFile(goldenDir, dataset, split), text);
  };
  const SET = `dataset: coffee-roaster
items:
  - { id: G1, question: What was revenue in April 2026?, kind: numeric, expected: 36200, tolerance: { abs: 0.5 },
      source: { kind: fact, label: revenue_2026-04 }, columns: [Amount, Date, Status], split: dev }
  - { id: G2, question: What will revenue be next year?, kind: trap, reason: No forecasts are made., source: { kind: ask }, split: dev }
`;

  it("runs the job as the real tier does, asks the ask items, scores and prints each item", async () => {
    const g = dir();
    try {
      write(g, "coffee-roaster", "dev", SET);
      const lines: string[] = [];
      const [r] = await goldenEvalCommand(
        {
          model: "baseline",
          split: "dev",
          dataDir: join(EXAMPLES, "coffee-roaster"),
          answersDir: join(EXAMPLES, "my-evals"),
          goldenDir: g,
        },
        { embedder: hashEmbedder(), print: (l) => lines.push(l) },
      );
      expect(r?.completed).toBe(true);
      expect(r?.items.map((i) => [i.id, i.pass])).toEqual([
        ["G1", true],
        ["G2", false],
      ]);
      // The baseline has no script for follow-up questions: a trap it can't answer is a miss, not a refusal.
      expect(r?.items[1]?.got).toMatch(/^no answer \(/);
      expect(r?.summary).toEqual({ numericCategorical: { passed: 0, of: 0 }, traps: { passed: 0, of: 0 }, notCounted: 2 });
      expect(lines[0]).toMatch(/^coffee-roaster \(dev, baseline\): 1\/2 pass · /);
      expect(lines[1]).toMatch(/^ {2}G1 +pass numeric +fact +expected 36200; got 36200(\.\d+)? — What was revenue in April 2026\?$/);
      expect(lines.at(-1)).toContain("2 not counted");
    } finally {
      rmSync(g, { recursive: true, force: true });
    }
  }, 120_000);

  // The job uses the scripted baseline; every follow-up question then meets a model that throws `err`.
  const failingAsk = (err: Error) => {
    let calls = 0;
    return (): ModelClient => {
      if (calls++ === 0) return baselineModel();
      const fail = () => Promise.reject(err);
      return { generateObject: fail, generateWithTools: fail, embed: fail };
    };
  };
  const runWith = (model: () => ModelClient, goldenDir: string) =>
    runGoldenSet({
      dataset: "coffee-roaster",
      split: "dev",
      model,
      modelName: "baseline",
      embedder: hashEmbedder(),
      dataDir: join(EXAMPLES, "coffee-roaster"),
      answersDir: join(EXAMPLES, "my-evals"),
      goldenDir,
    });

  it("a model failure on a follow-up question, even wrapped in a cause, is that item's miss; any other error stops the run", async () => {
    const g = dir();
    try {
      write(g, "coffee-roaster", "dev", SET);
      const direct = await runWith(failingAsk(new ModelError("PROVIDER", "provider down")), g);
      expect(direct.items[1]?.got).toBe("no answer (provider down)");
      const wrapped = new Error("the agent gave up", { cause: new ModelError("RATE_LIMITED", "rate limited") });
      expect((await runWith(failingAsk(wrapped), g)).items[1]?.got).toBe("no answer (the agent gave up)");
      await expect(runWith(failingAsk(new TypeError("x is undefined")), g)).rejects.toThrow("x is undefined");
    } finally {
      rmSync(g, { recursive: true, force: true });
    }
  }, 120_000);

  it("refuses a file about another dataset or holding another split's items, and a missing data file (NO_DATA)", async () => {
    const g = dir();
    try {
      write(g, "coffee-roaster", "dev", SET.replace("dataset: coffee-roaster", "dataset: other"));
      expect(() => loadGoldenSet(g, "coffee-roaster", "dev")).toThrow(/about other, not coffee-roaster/);
      write(g, "coffee-roaster", "heldout", SET);
      expect(() => loadGoldenSet(g, "coffee-roaster", "heldout")).toThrow(/another split: G1, G2/);
      expect(() => loadGoldenSet(g, "nope", "dev")).toThrow(/no dev golden set for nope/);
      write(g, "coffee-roaster", "dev", SET);
      await expect(
        runGoldenSet({
          dataset: "coffee-roaster",
          split: "dev",
          model: () => baselineModel(),
          modelName: "baseline",
          embedder: hashEmbedder(),
          dataDir: g,
          answersDir: join(EXAMPLES, "my-evals"),
          goldenDir: g,
        }),
      ).rejects.toMatchObject({ code: "NO_DATA" });
    } finally {
      rmSync(g, { recursive: true, force: true });
    }
  });
});

describe("held-out honesty (accuracy.md §4)", () => {
  // Release runs alone read heldout.yaml, through evals/runner. The engine must never see the golden questions or
  // answers: nothing under packages/ imports the eval runner, no file under packages/ or apps/ names the held-out file
  // or the golden folder, and under apps/ only the CLI's eval command (the release-run entry) touches the golden API.
  const SKIP = new Set(["node_modules", "dist", ".astro", ".turbo", "coverage", "test-results", "playwright-report"]);
  const TEXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|json|ya?ml|md|mdx|astro|sql|html|css)$/;
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

  // `aa eval --suite golden --split heldout` is how a release run reads the held-out split.
  const RELEASE_ENTRY = new Set(["apps/cli/src/main.ts"]);
  const GOLDEN_API = /\b(GOLDEN_DIR|goldenFile|loadGoldenSet|runGoldenSet|goldenEvalCommand|goldenDatasets)\b|["'`]heldout["'`]/;
  const PATHS = /heldout\.ya?ml|evals[\\/]golden|["'`]evals["'`]\s*,\s*["'`]golden["'`]/;
  const rel = (f: string) => relative(ROOT, f).split("\\").join("/");

  it("nothing under packages/ imports the eval runner", () => {
    const files = walk(join(ROOT, "packages"), []);
    expect(files.length).toBeGreaterThan(50);
    expect(files.filter((f) => readFileSync(f, "utf8").includes("@agentic-analytics/eval-runner")).map(rel)).toEqual([]);
  });

  it("no file under packages/ or apps/ names heldout.yaml or the evals/golden folder", () => {
    const files = [...walk(join(ROOT, "packages"), []), ...walk(join(ROOT, "apps"), [])];
    expect(files.filter((f) => PATHS.test(readFileSync(f, "utf8"))).map(rel)).toEqual([]);
  });

  it("under apps/, only the CLI's eval command uses the golden API or the held-out split", () => {
    const files = walk(join(ROOT, "apps"), []);
    expect(files.filter((f) => !RELEASE_ENTRY.has(rel(f)) && GOLDEN_API.test(readFileSync(f, "utf8"))).map(rel)).toEqual([]);
    // The allow-list stays true: the entry really is where the split is chosen.
    expect(readFileSync(join(ROOT, "apps/cli/src/main.ts"), "utf8")).toMatch(GOLDEN_API);
  });
});
