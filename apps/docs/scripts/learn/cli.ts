// 2. The CLI, spawned as a reader runs it (learn-data.ts): `aa analyze`, `aa metrics`, `aa explain`, `aa ask` and
// `aa eval`, with a clean environment in a scratch folder, for the tutorials' transcripts.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Report } from "@agentic-analytics/schema";
import { type FactLike, formatWithCurrency } from "../../src/components/format.ts";
import type { Transcript } from "../../src/components/learn/types.ts";
import { LearnDataError, need, ROOT } from "./shared.ts";

const AA = join(ROOT, "apps", "cli", "bin", "aa.js");

interface Spawned {
  readonly out: string;
  readonly code: number;
}

/** Runs `aa <args>` in `cwd` with only the variables given (no .env, no config file, no inherited model settings). */
function aa(args: readonly string[], cwd: string, env: Record<string, string>, input?: string): Promise<Spawned> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [AA, ...args], {
      cwd,
      env: { PATH: process.env.PATH ?? "", HOME: cwd, NO_COLOR: "1", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      out += c.toString();
    });
    const timer = setTimeout(() => child.kill(), 240_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ out, code: code ?? -1 });
    });
    child.stdin.end(input ?? "");
  });
}

const JOB_ID = /job-\d{14}-[0-9a-f]{6}/g;

/** Presentation of a recorded session: what varies per machine or run is replaced, and the page says what. */
function transcript(command: string, raw: string, replace: readonly [RegExp | string, string, string][]): Transcript {
  let text = raw;
  const normalised: string[] = [];
  for (const [from, to, why] of replace) {
    const before = text;
    text = typeof from === "string" ? text.split(from).join(to) : text.replace(from, to);
    if (text !== before && !normalised.includes(why)) normalised.push(why);
  }
  const lines = text.replace(/\n+$/, "").split("\n");
  return { command, lines, normalised };
}

const DURATIONS: [RegExp, string, string] = [/\((\d+) ms\)/g, "(… ms)", "stage durations"];
const JOBS: [RegExp, string, string] = [JOB_ID, "<job-id>", "the job id (a timestamp)"];

export async function cliRuns() {
  const tmp = mkdtempSync(join(tmpdir(), "aa-learn-cli-"));
  try {
    symlinkSync(join(ROOT, "examples"), join(tmp, "examples"));
    // The CLI's HOME is this empty folder, but DuckDB keeps its extensions under $HOME/.duckdb: link the real one, so
    // the full-text extension every engine run on this machine has installed is reused, not downloaded again (offline,
    // a download fails the run). Like any engine run, it creates ~/.duckdb if missing and installs into it when it must.
    const duckdb = join(homedir(), ".duckdb");
    mkdirSync(duckdb, { recursive: true });
    symlinkSync(duckdb, join(tmp, ".duckdb"));
    const jobs = join(tmp, "jobs");
    const scripted = { AA_DEMO_MODEL: "scripted", AA_JOBS_DIR: jobs };
    const base = "--embedder hash --today 2026-07-01 --currency USD";
    const out = (name: string) => join(tmp, name);
    const paths = (dir: string): [string, string, string] => [`${dir}/`, "", "the report folder (the current folder)"];

    // Tutorial 1: the first file.
    const first = await aa(["analyze", "examples/coffee-roaster", "--yes", ...base.split(" "), "--out", out("first")], tmp, scripted);
    if (first.code !== 0) throw new LearnDataError(`aa analyze failed:\n${first.out}`);
    const jobId = need(first.out.match(JOB_ID)?.[0], "the job id");
    // `aa explain` reads the stored facts: no model of any kind is involved.
    const explainPct = await aa(["explain", jobId, "N30"], tmp, { AA_JOBS_DIR: jobs });
    const explainSql = await aa(["explain", jobId, "N11"], tmp, { AA_JOBS_DIR: jobs });
    const ask = await aa(["ask", jobId, "why did revenue fall in April?"], tmp, scripted);

    // Tutorial 2: metrics, drafted and reviewed.
    const metrics = await aa(
      [
        "metrics",
        "examples/coffee-roaster",
        "--yes",
        "--currency",
        "USD",
        "--today",
        "2026-07-01",
        "--save",
        "agentic-analytics.metrics.yaml",
      ],
      tmp,
      // No model is running here: drafting falls back to deterministic rules and says why.
      { OLLAMA_BASE_URL: "http://127.0.0.1:9" },
    );
    const saved = readFileSync(join(tmp, "agentic-analytics.metrics.yaml"), "utf8");
    // The column roles (one question), the business model, then the ten metrics (the KPI pack's eight, then the retail and
    // wholesale slices): refund_rate, the eighth, is dropped.
    const answers = ["a", "a", "a", "a", "a", "a", "a", "a", "a", "d", "a", "a"];
    const review = await aa(
      ["analyze", "examples/coffee-roaster", ...base.split(" "), "--out", out("review")],
      tmp,
      scripted,
      `${answers.join("\n")}\n`,
    );
    if (review.code !== 0) throw new LearnDataError(`aa analyze (review) failed:\n${review.out}`);
    let k = 0;
    // Piped answers aren't echoed; a terminal shows what you typed after each question.
    const reviewOut = review.out.replace(/\[d\]rop: /g, (m) => `${m}${answers[k++] ?? ""}\n`);

    // Tutorial 3: the workbook alone, then with the documents.
    const alone = await aa(
      ["analyze", "examples/coffee-roaster/sales-2026.xlsx", "--yes", ...base.split(" "), "--out", out("alone")],
      tmp,
      scripted,
    );
    if (alone.code !== 0) throw new LearnDataError(`aa analyze (workbook only) failed:\n${alone.out}`);
    const claimsOf = (dir: string) => {
      const rep = JSON.parse(readFileSync(join(dir, "agentic-analytics", "report.json"), "utf8")) as Report;
      const f = need(rep.findings[0], "a finding");
      const facts = new Map(rep.facts.map((x) => [x.id, x]));
      return {
        title: f.title,
        claims: f.claims.map((c) => ({
          // Filled from this run's own facts (presentation only): the ids belong to this job, not the stage run.
          text: c.text.replace(/\{\{(N\d+)\}\}/g, (m, id: string) => {
            const x = facts.get(id);
            return x ? formatWithCurrency({ ...(x as FactLike), currency: x.currency ?? null }) : m;
          }),
          grade: c.causal_grade ?? null,
          sources: [...new Set(c.citations.map((x) => rep.sources.find((s) => s.id === x.source_id)?.file ?? x.source_id))],
        })),
      };
    };

    // Tutorial 5: evals on your own data.
    const evalRun = await aa(
      ["eval", "--suite", "real", "--answers", "examples/my-evals", "--data", "examples/coffee-roaster", "--results-dir", out("my-evals")],
      tmp,
      {},
    );
    if (evalRun.code !== 0) throw new LearnDataError(`aa eval failed:\n${evalRun.out}`);

    const transcripts: Record<string, Transcript> = {
      analyze: transcript(`AA_DEMO_MODEL=scripted bun run aa analyze examples/coffee-roaster --yes ${base}`, first.out, [
        DURATIONS,
        JOBS,
        paths(out("first")),
      ]),
      explainPct: transcript("bun run aa explain <job-id> N30", explainPct.out, [JOBS]),
      explainSql: transcript("bun run aa explain <job-id> N11", explainSql.out, [JOBS]),
      ask: transcript('AA_DEMO_MODEL=scripted bun run aa ask <job-id> "why did revenue fall in April?"', ask.out, [JOBS]),
      metrics: transcript(
        "bun run aa metrics examples/coffee-roaster --yes --currency USD --today 2026-07-01 --save agentic-analytics.metrics.yaml",
        metrics.out,
        [[/unavailable \([^)]*\)/g, "unavailable (…)", "the reason no model answered (it depends on your setup)"]],
      ),
      review: (() => {
        const t = transcript(`AA_DEMO_MODEL=scripted bun run aa analyze examples/coffee-roaster ${base}`, reviewOut, [
          DURATIONS,
          JOBS,
          paths(out("review")),
        ]);
        // The answers were piped in, and piped input isn't echoed: they are written after each question, as a terminal shows them.
        return { ...t, normalised: [...t.normalised, "your answers, written after each question (piped input isn't echoed)"] };
      })(),
      alone: transcript(`AA_DEMO_MODEL=scripted bun run aa analyze examples/coffee-roaster/sales-2026.xlsx --yes ${base}`, alone.out, [
        DURATIONS,
        JOBS,
        paths(out("alone")),
      ]),
      eval: transcript(
        "bun run aa eval --suite real --answers examples/my-evals --data examples/coffee-roaster --results-dir data/my-evals",
        evalRun.out,
        [
          [/ · \d+\.\d s/g, " · … s", "the run time"],
          [`${out("my-evals")}/`, "data/my-evals/", "the results folder"],
          [/\d{4}-\d{2}-\d{2}-baseline-real/g, "<date>-baseline-real", "the date in the results file name"],
        ],
      ),
    };
    return {
      transcripts,
      saved,
      evidence: { without: claimsOf(out("alone")), with: claimsOf(out("first")) },
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
