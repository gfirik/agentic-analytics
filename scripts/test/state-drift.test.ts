// scripts/state-drift.mjs and scripts/daily-summary.sh: a STATE row whose linked PRs have all merged is drift, not
// work in progress; a row with an open PR or no PR link stays in progress; if GitHub can't be asked, the summary says
// so instead of guessing. gh is a stand-in that answers from a table: no network.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { drifted, movingRows } from "../state-drift.mjs";

const STATE = `| Milestone | Status | Gate | PR | Demo | Notes |
|---|---|---|---|---|---|
| M14 Golden suite | DONE | notify | [#76](https://github.com/gfirik/agentic-analytics/pull/76) | x | y |
| Site v4 PR 1: width | AWAITING_REVIEW (draft PR) | notify | [#56](https://github.com/gfirik/agentic-analytics/pull/56) (draft) | x | y |
| Site v5 PR 2: story | IN_REVIEW (PR open) | notify | [#87](https://github.com/gfirik/agentic-analytics/pull/87) | x | y |
| Split row | IN_PROGRESS | notify | [#90](https://github.com/gfirik/agentic-analytics/pull/90), [#91](https://github.com/gfirik/agentic-analytics/pull/91) | x | y |
| M15 Business semantics | IN_PROGRESS | notify | — | x | y |
| M16 Later | TODO | notify | — | x | y |
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A fake repo: STATE.md, the two scripts, and a gh that reports PRs in `merged` as MERGED, others as OPEN. */
function fakeRepo(merged: number[], ghFails = false) {
  const repo = mkdtempSync(join(tmpdir(), "aa-state-drift-"));
  dirs.push(repo);
  for (const d of ["scripts", "bin", "docs/progress"]) mkdirSync(join(repo, d), { recursive: true });
  for (const f of ["state-drift.mjs", "daily-summary.sh"]) copyFileSync(join(import.meta.dirname, "..", f), join(repo, "scripts", f));
  writeFileSync(join(repo, "docs/progress/STATE.md"), STATE);
  writeFileSync(join(repo, "scripts", "notify.sh"), "#!/usr/bin/env bash\necho sent\n");
  const gh = join(repo, "bin", "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
${ghFails ? "echo 'could not resolve host' >&2; exit 1" : ""}
[ "$1 $2" = "pr list" ] && exit 0
case " ${merged.join(" ")} " in *" $3 "*) echo MERGED ;; *) echo OPEN ;; esac
`,
  );
  chmodSync(gh, 0o755);
  return { repo, gh };
}

const run = (repo: string, gh: string, args: string[]) =>
  spawnSync("node", [join(repo, "scripts", "state-drift.mjs"), ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, AA_GH: gh },
  });

describe("state-drift", () => {
  it("reads the moving rows and their PR links, skipping DONE and TODO", () => {
    expect(movingRows(STATE)).toEqual([
      { name: "Site v4 PR 1: width", status: "AWAITING_REVIEW (draft PR)", prs: [56] },
      { name: "Site v5 PR 2: story", status: "IN_REVIEW (PR open)", prs: [87] },
      { name: "Split row", status: "IN_PROGRESS", prs: [90, 91] },
      { name: "M15 Business semantics", status: "IN_PROGRESS", prs: [] },
    ]);
  });

  it("calls a row drifted only when every linked PR merged", () => {
    const merged = new Set([56, 90]);
    expect(movingRows(STATE).map((r) => drifted(r, merged))).toEqual([true, false, false, false]);
  });

  it("prints the drifted rows, and --moving prints the rest", () => {
    const { repo, gh } = fakeRepo([56, 87, 90]);
    const drift = run(repo, gh, []);
    expect(drift.status).toBe(0);
    expect(drift.stdout.trim().split("\n")).toEqual([
      "Site v4 PR 1: width — STATE says AWAITING_REVIEW (draft PR); #56 merged",
      "Site v5 PR 2: story — STATE says IN_REVIEW (PR open); #87 merged",
    ]);
    const moving = run(repo, gh, ["--moving"]);
    expect(moving.stdout.trim().split("\n")).toEqual(["Split row | IN_PROGRESS", "M15 Business semantics | IN_PROGRESS"]);
  });

  it("exits 2 when gh can't be asked", () => {
    const { repo, gh } = fakeRepo([], true);
    expect(run(repo, gh, []).status).toBe(2);
  });
});

describe("daily-summary.sh", () => {
  const summary = (repo: string, gh: string) =>
    spawnSync("bash", [join(repo, "scripts", "daily-summary.sh")], {
      cwd: tmpdir(),
      encoding: "utf8",
      env: { ...process.env, AA_GH: gh, DRY: "1" },
    });

  it("leaves merged rows out of In progress and names them under STATE drift", () => {
    const { repo, gh } = fakeRepo([56, 87]);
    const out = summary(repo, gh).stdout;
    expect(out).toMatch(/In progress: Split row \| IN_PROGRESS\nM15 Business semantics \| IN_PROGRESS\n/);
    expect(out).toContain("STATE drift: Site v4 PR 1: width — STATE says AWAITING_REVIEW (draft PR); #56 merged");
    expect(out.slice(out.indexOf("In progress:"), out.indexOf("STATE drift:"))).not.toContain("Site v4");
  });

  it("says none when STATE matches GitHub", () => {
    const { repo, gh } = fakeRepo([]);
    expect(summary(repo, gh).stdout).toContain("STATE drift: none");
  });

  it("falls back to STATE alone, marked unchecked, when gh fails", () => {
    const { repo, gh } = fakeRepo([], true);
    const out = summary(repo, gh).stdout;
    expect(out).toContain("(not checked against GitHub)");
    expect(out).toContain("STATE drift: not checked (gh failed)");
  });
});
