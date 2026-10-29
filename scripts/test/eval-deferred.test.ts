// scripts/eval-deferred.sh (the nightly slot for M14's deferred real-model runs): one queued run a night on a model of
// its own, a finished run never repeated, a rate-limited one run again, the model kept across nights. The script runs
// in a copy of the repo layout with stand-ins for bun, heavy.sh and notify.sh: no eval, no lock, no network.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** A fake repo whose `bun run …` appends its arguments to `calls`, prints `output` and exits with `exit`. */
function fakeRepo() {
  const repo = mkdtempSync(join(tmpdir(), "aa-eval-deferred-"));
  dirs.push(repo);
  for (const d of ["scripts", "bin", "evals"]) mkdirSync(join(repo, d));
  copyFileSync(join(import.meta.dirname, "..", "eval-deferred.sh"), join(repo, "scripts", "eval-deferred.sh"));
  copyFileSync(join(import.meta.dirname, "..", "..", "evals", "deferred.txt"), join(repo, "evals", "deferred.txt"));
  script(join(repo, "scripts", "heavy.sh"), 'exec "$@"');
  script(join(repo, "scripts", "notify.sh"), `printf '%s' "$1" > "${join(repo, "notified")}"`);
  writeFileSync(join(repo, "output"), "");
  writeFileSync(join(repo, "exit"), "0");
  script(
    join(repo, "bin", "bun"),
    `shift; echo "$*" >> "${join(repo, "calls")}"; [ "$1" = eval:real:fetch ] && exit 0; cat "${join(repo, "output")}"; exit "$(cat "${join(repo, "exit")}")"`,
  );
  return repo;
}

const night = (repo: string, env: Record<string, string> = { AA_DEFERRED_MODEL: "llama-3.3-70b-versatile" }) =>
  spawnSync("bash", [join(repo, "scripts", "eval-deferred.sh")], {
    cwd: tmpdir(),
    env: { ...process.env, PATH: `${join(repo, "bin")}:${process.env.PATH ?? ""}`, ...env },
    encoding: "utf8",
  });
const calls = (repo: string) => (existsSync(join(repo, "calls")) ? readFileSync(join(repo, "calls"), "utf8").trim().split("\n") : []);
const done = (repo: string) => readFileSync(join(repo, "data", "cron", "deferred", "done"), "utf8").trim();

describe("eval-deferred.sh", () => {
  it("runs the first queued run on the deferred model, marks it finished and keeps the model for later nights", () => {
    const repo = fakeRepo();
    const r = night(repo);
    expect(r.status).toBe(0);
    // The queue's comments (one has an apostrophe) are skipped quietly: xargs once choked on it.
    expect(r.stderr).not.toMatch(/xargs|unmatched/);
    // The golden run reads the real data, fetched first.
    expect(calls(repo)).toEqual(["eval:real:fetch", "eval -- --suite golden --model openai-compatible:groq:llama-3.3-70b-versatile"]);
    expect(done(repo)).toBe("golden-v1");
    expect(readFileSync(join(repo, "notified"), "utf8")).toMatch(/^eval deferred: golden-v1 on llama-3\.3-70b-versatile finished/);
    // The next night: the next entry, on the same model even if the override now names another.
    night(repo, { AA_DEFERRED_MODEL: "other-model" });
    expect(calls(repo).at(-1)).toBe("eval:ablation -- --arms A,B,C --suite smoke --model openai-compatible:groq:llama-3.3-70b-versatile");
    expect(done(repo)).toBe("golden-v1\nablation-smoke");
  });

  it("runs a rate-limited run again the next night, and counts exit 1 (a bar missed) as finished", () => {
    const repo = fakeRepo();
    writeFileSync(join(repo, "output"), "[1/3] hotel-bookings: failed (RATE_LIMITED: daily tokens)\n");
    writeFileSync(join(repo, "exit"), "1");
    night(repo);
    expect(done(repo)).toBe("");
    expect(readFileSync(join(repo, "notified"), "utf8")).toMatch(
      /golden-v1 .* stopped \(exit 1, 1 rate-limit lines\); it runs again tomorrow night/,
    );
    writeFileSync(join(repo, "output"), "counted toward the bars: 9/20\n");
    night(repo);
    expect(calls(repo).filter((c) => c.startsWith("eval --")).length).toBe(2);
    expect(done(repo)).toBe("golden-v1");
  });

  it("doesn't count a crash (exit 2) as finished", () => {
    const repo = fakeRepo();
    writeFileSync(join(repo, "exit"), "2");
    night(repo);
    expect(done(repo)).toBe("");
  });

  it("runs nothing once every queued run has finished", () => {
    const repo = fakeRepo();
    mkdirSync(join(repo, "data", "cron", "deferred"), { recursive: true });
    writeFileSync(
      join(repo, "data", "cron", "deferred", "done"),
      "golden-v1\nablation-smoke\nablation-golden\nrepeat-smoke\ngolden-m15\nroles-m15\n",
    );
    const r = night(repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/every queued run has finished/);
    expect(calls(repo)).toEqual([]);
  });
});
