// scripts/daily-summary.sh: its "Nightly" line is the scheduled eval's own summary line, from the newest nightly or
// weekly log (scripts/eval-daily.sh). Until 2026-11-19 it read the old eval-full-*.log names and kept reporting the
// last run before the rename. Run with DRY=1 in a copy of the layout, with a stand-in for gh: nothing is sent.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeRepo(logs: Record<string, string>) {
  const repo = mkdtempSync(join(tmpdir(), "aa-daily-summary-"));
  dirs.push(repo);
  for (const d of ["scripts", "bin", "data/logs", "docs/progress"]) mkdirSync(join(repo, d), { recursive: true });
  for (const f of ["daily-summary.sh", "state-drift.mjs"]) copyFileSync(join(import.meta.dirname, "..", f), join(repo, "scripts", f));
  writeFileSync(join(repo, "docs", "progress", "STATE.md"), "# State\n");
  writeFileSync(join(repo, "bin", "gh"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(repo, "bin", "gh"), 0o755);
  // Oldest first: each log a minute newer than the one before.
  Object.entries(logs).forEach(([name, text], i) => {
    const path = join(repo, "data", "logs", name);
    writeFileSync(path, text);
    const t = new Date(Date.now() - (Object.keys(logs).length - i) * 60_000);
    utimesSync(path, t, t);
  });
  return repo;
}

const summary = (repo: string) =>
  spawnSync("bash", [join(repo, "scripts", "daily-summary.sh")], {
    cwd: tmpdir(),
    env: { ...process.env, DRY: "1", AA_GH: join(repo, "bin", "gh") },
    encoding: "utf8",
  }).stdout;

describe("daily-summary.sh", () => {
  it("reports the newest scheduled pass from its summary line, not an old eval-full log", () => {
    const out = summary(
      fakeRepo({
        "eval-full-2026-11-16.log":
          "combined: 28 of 30 jobs finished over 2 of up to 2 passes: partial\nPlanted recall@5: 84.0% (bar ≥ 80%)\n",
        "eval-nightly-2026-11-18.log":
          "[1/1] a-v1: done\nPlanted recall@5: 50.0% (bar ≥ 80%)\nsummary: eval nightly (fresh, 1 of 30 datasets: a-v1): 1 of 1 jobs finished; cache hits 0 of 9 calls (0%); a bar was missed (results: data/eval-runs/x; log: y)\n",
      }),
    );
    expect(out).toContain(
      "Nightly (eval-nightly-2026-11-18.log): eval nightly (fresh, 1 of 30 datasets: a-v1): 1 of 1 jobs finished; cache hits 0 of 9 calls (0%); a bar was missed\n",
    );
    expect(out).not.toContain("28 of 30");
  });

  it("falls back to the result lines of a pass that wrote no summary line", () => {
    const out = summary(fakeRepo({ "eval-weekly-2026-11-22.log": "[1/30] a-v1: done\nPlanted recall@5: 84.0% (bar ≥ 80%)\n" }));
    expect(out).toContain("Nightly (eval-weekly-2026-11-22.log): Planted recall@5: 84.0% (bar ≥ 80%)");
  });
});
