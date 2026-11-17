// scripts/eval-daily.sh (the scheduled eval, run from cron, docs/EVALS.md §4): a fresh pass (response cache off) that
// writes only under data/, picks a rotating eighth of the suite on nightly passes and the whole suite on weekly ones,
// skips when the planner's 24-hour quota can't take it, and reports the cache-hit rate. Its log is one file per mode
// and UTC day, appended to, so a same-day rerun counts only its own job lines. The script runs in a copy of the repo
// layout with stand-ins for bun, heavy.sh and notify.sh: no eval, no lock, no network.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const script = (path: string, body: string) => {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
};

const DATASETS = ["agency", "clinic", "coffee_roaster", "construction_supplier", "distributor"].flatMap((a) =>
  [1, 2, 3].map((v) => `${a}-v${v}`),
);

const call = (o: { cached: boolean; role?: string; tokens?: number; at?: string }) =>
  `${JSON.stringify({
    at: o.at ?? new Date().toISOString(),
    role: o.role ?? "planner",
    provider: "openai-compatible",
    model: "m",
    status: 200,
    cached: o.cached,
    inputTokens: o.cached ? 0 : (o.tokens ?? 0),
    outputTokens: 0,
  })}\n`;

/** A fake repo whose `bun run eval` prints `evalOutput`, records its arguments and appends `calls` to the call log. */
function fakeRepo(evalOutput: string, calls = "") {
  const repo = mkdtempSync(join(tmpdir(), "aa-eval-daily-"));
  dirs.push(repo);
  mkdirSync(join(repo, "scripts"));
  mkdirSync(join(repo, "bin"));
  mkdirSync(join(repo, "data", "logs"), { recursive: true });
  for (const d of DATASETS) mkdirSync(join(repo, "evals", "datasets", "generated", d), { recursive: true });
  copyFileSync(join(import.meta.dirname, "..", "eval-daily.sh"), join(repo, "scripts", "eval-daily.sh"));
  script(join(repo, "scripts", "heavy.sh"), 'exec "$@"');
  script(join(repo, "scripts", "notify.sh"), `printf '%s' "$1" > "${join(repo, "notified")}"`);
  writeFileSync(join(repo, "eval-output.txt"), evalOutput);
  writeFileSync(join(repo, "calls.txt"), calls);
  script(
    join(repo, "bin", "bun"),
    `[ "$2" = eval ] || exit 0
printf '%s\\n' "$@" > "${join(repo, "eval-args")}"
cat "${join(repo, "calls.txt")}" >> data/logs/model-calls.jsonl
cat "${join(repo, "eval-output.txt")}"`,
  );
  return repo;
}

const runDaily = (repo: string, mode: string, env: Record<string, string> = {}) =>
  spawnSync("bash", [join(repo, "scripts", "eval-daily.sh"), mode], {
    cwd: tmpdir(),
    env: { ...process.env, PATH: `${join(repo, "bin")}:${process.env.PATH ?? ""}`, ...env },
    encoding: "utf8",
  });

const evalArgs = (repo: string) => readFileSync(join(repo, "eval-args"), "utf8").trim().split("\n");
const day = () => new Date().toISOString().slice(0, 10);

describe("eval-daily.sh", () => {
  it("runs a nightly eighth fresh, writes under data/, and reports the cache-hit rate and planner tokens", () => {
    const repo = fakeRepo(
      "[1/2] a-v1: done\n[2/2] b-v1: failed (RATE_LIMITED: quota)\nPlanted recall@5: 84.0% (bar ≥ 80%)\nDriver accuracy: 96.4% (bar ≥ 90%)\n",
      call({ cached: false, tokens: 1200 }) + call({ cached: false, role: "extractor", tokens: 500 }) + call({ cached: true }),
    );
    // 2026-11-18 is day 20775 since the epoch: 20775 % 8 = 7, so the 8th, 16th… of the sorted 15 here.
    const r = runDaily(repo, "nightly", { AA_TODAY: "2026-11-18" });
    expect(r.status).toBe(0);
    const args = evalArgs(repo);
    expect(args).toEqual(expect.arrayContaining(["--no-cache", "--suite", "full", "--model", "configured", "--small-model"]));
    expect(args[args.indexOf("--only") + 1]).toBe("coffee_roaster-v2");
    expect(args[args.indexOf("--results-dir") + 1]).toBe("data/eval-runs/nightly-2026-11-18");
    const summary = `eval nightly (fresh, 1 of 15 datasets: coffee_roaster-v2): 1 of 2 jobs finished, 1 stopped on the rate limit, 0 failed otherwise; cache hits 1 of 3 calls (33%); 1,200 planner tokens; Planted recall@5: 84.0%, Driver accuracy: 96.4% (results: data/eval-runs/nightly-2026-11-18; log: data/logs/eval-nightly-${day()}.log)`;
    expect(r.stdout.trim().split("\n").at(-1)).toBe(summary);
    expect(readFileSync(join(repo, "notified"), "utf8")).toBe(summary);
  });

  it("rotates the nightly subset so consecutive nights take different datasets", () => {
    const repo = fakeRepo("");
    runDaily(repo, "nightly", { AA_TODAY: "2026-11-19" });
    const ids = evalArgs(repo)[evalArgs(repo).indexOf("--only") + 1];
    expect(ids).toBe("agency-v1,coffee_roaster-v3");
  });

  it("runs the whole suite on a weekly pass and on the weekly day in auto mode", () => {
    const repo = fakeRepo("[1/1] a-v1: done\n");
    // 2026-11-22 is a Sunday.
    const r = runDaily(repo, "auto", { AA_TODAY: "2026-11-22" });
    expect(r.status).toBe(0);
    const args = evalArgs(repo);
    expect(args).not.toContain("--only");
    expect(args).toContain("--no-cache");
    expect(args[args.indexOf("--results-dir") + 1]).toBe("data/eval-runs/weekly-2026-11-22");
    expect(r.stdout).toContain("eval weekly (fresh, all 15 datasets): 1 of 1 jobs finished");
    expect(r.stdout).toContain("cache hits 0 of 0 calls (n/a)");
  });

  it("skips, without running the eval, when the last 24 hours' planner tokens leave no room", () => {
    const repo = fakeRepo("[1/1] a-v1: done\n");
    writeFileSync(
      join(repo, "data", "logs", "model-calls.jsonl"),
      call({ cached: false, tokens: 130000 }) +
        call({ cached: false, tokens: 90000, at: new Date(Date.now() - 2 * 864e5).toISOString() }) +
        call({ cached: false, role: "judge", tokens: 50000 }),
    );
    const r = runDaily(repo, "weekly");
    expect(r.status).toBe(0);
    expect(() => readFileSync(join(repo, "eval-args"))).toThrow();
    expect(readFileSync(join(repo, "notified"), "utf8")).toBe(
      "eval weekly skipped: 130,000 planner tokens used in the last 24 h + about 140,000 for this pass would pass the 200,000 free-tier limit",
    );
    // The same day's nightly estimate still fits.
    expect(runDaily(repo, "nightly").stdout).not.toContain("skipped");
  });

  it("counts only this run's lines in a log a same-day earlier run already wrote to", () => {
    const repo = fakeRepo("[1/3] a-v1: done\n[2/3] b-v1: failed (RATE_LIMITED: quota)\n[3/3] c-v1: failed (BAD_OUTPUT: x)\n");
    const log = join(repo, "data", "logs", `eval-weekly-${day()}.log`);
    writeFileSync(log, `[earlier] header\n${[1, 2, 3, 4, 5].map((i) => `[${i}/5] x${i}: done`).join("\n")}\n`);
    const r = runDaily(repo, "weekly");
    expect(r.stdout).toContain("1 of 3 jobs finished, 1 stopped on the rate limit, 1 failed otherwise");
    expect(readFileSync(log, "utf8")).toMatch(/x5: done\n\[.*--suite full --model configured --small-model --no-cache --results-dir/);
  });

  it("refuses an unknown mode", () => {
    const r = runDaily(fakeRepo(""), "smoke");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("usage: eval-daily.sh [auto|nightly|weekly]");
  });
});
