// scripts/eval-daily.sh (the nightly pass, run from cron): its log is one file per UTC day, appended to, so a
// same-day rerun must count only its own job lines in the summary, not the earlier run's as well. The script runs in
// a copy of the repo layout with stand-ins for bun, heavy.sh and notify.sh: no eval, no lock, no network.
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

/** A fake repo whose `bun run eval` prints `evalOutput`; returns where things land. */
function fakeRepo(evalOutput: string) {
  const repo = mkdtempSync(join(tmpdir(), "aa-eval-daily-"));
  dirs.push(repo);
  mkdirSync(join(repo, "scripts"));
  mkdirSync(join(repo, "bin"));
  copyFileSync(join(import.meta.dirname, "..", "eval-daily.sh"), join(repo, "scripts", "eval-daily.sh"));
  script(join(repo, "scripts", "heavy.sh"), 'exec "$@"');
  script(join(repo, "scripts", "notify.sh"), `printf '%s' "$1" > "${join(repo, "notified")}"`);
  writeFileSync(join(repo, "eval-output.txt"), evalOutput);
  script(join(repo, "bin", "bun"), `[ "$2" = eval ] && cat "${join(repo, "eval-output.txt")}"; exit 0`);
  return repo;
}

const runDaily = (repo: string) =>
  spawnSync("bash", [join(repo, "scripts", "eval-daily.sh"), "full"], {
    cwd: tmpdir(),
    env: { ...process.env, PATH: `${join(repo, "bin")}:${process.env.PATH ?? ""}` },
    encoding: "utf8",
  });

describe("eval-daily.sh", () => {
  it("counts only this run's lines in a log a same-day earlier run already wrote to", () => {
    const repo = fakeRepo(
      "[1/3] a-v1: done\n[2/3] b-v1: failed (RATE_LIMITED: quota)\n[3/3] c-v1: failed (BAD_OUTPUT: x)\ncombined: second\n",
    );
    const day = new Date().toISOString().slice(0, 10);
    const log = join(repo, "data", "logs", `eval-full-${day}.log`);
    mkdirSync(join(repo, "data", "logs"), { recursive: true });
    // The earlier run the same day: five jobs, all finished, and its own combined line.
    writeFileSync(log, `[earlier] header\n${[1, 2, 3, 4, 5].map((i) => `[${i}/5] x${i}: done`).join("\n")}\ncombined: first\n`);
    const r = runDaily(repo);
    expect(r.status).toBe(0);
    const summary = `eval full (daily pass): 1 of 3 jobs run tonight finished, 1 stopped on the rate limit, 1 failed otherwise; combined: second (log: data/logs/eval-full-${day}.log)`;
    expect(r.stdout.trim().split("\n").at(-1)).toBe(summary);
    expect(readFileSync(join(repo, "notified"), "utf8")).toBe(summary);
    // The log keeps both runs, appended.
    expect(readFileSync(log, "utf8")).toMatch(/combined: first\n\[.*--suite full --model configured --passes 2 ?\n\[1\/3\]/);
  });

  it("counts a first run of the day from an empty log", () => {
    const repo = fakeRepo("[1/1] a-v1: done\n");
    const r = runDaily(repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1 of 1 jobs run tonight finished, 0 stopped on the rate limit, 0 failed otherwise (log: ");
  });
});
