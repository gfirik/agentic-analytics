// Cross-checks docs/progress/STATE.md against GitHub: a row whose status isn't DONE but whose linked PRs have all
// merged has drifted (site v4 PRs 1–3 sat as AWAITING_REVIEW drafts for days after #56, #67 and #72 merged, and the
// daily summary listed them as in progress). The daily summary (scripts/daily-summary.sh) uses it to list only rows
// that are really moving and to name the drifted ones.
//
// Usage: node scripts/state-drift.mjs [STATE.md] [--moving]
//   default    prints one line per drifted row: "<row> — STATE says <status>; #N merged"
//   --moving   prints the rows still moving instead: "<row> | <status>", leaving out drifted ones
// Exits 0 either way; 2 when gh can't be asked (the summary then falls back to STATE alone).
// AA_GH names the gh binary (tests use a stand-in).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MOVING = /^(IN_PROGRESS|IN_REVIEW|AWAITING_REVIEW|BLOCKED)\b/;
const REPO = "gfirik/agentic-analytics";
const GH_ENV = "AA_GH";

/** Status-table rows that aren't DONE: name, status and the PR numbers linked in the PR column. */
export function movingRows(state) {
  const rows = [];
  for (const line of state.split("\n")) {
    if (!line.startsWith("| ")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const [, name, status, , pr] = cells;
    if (!name || !status || !MOVING.test(status)) continue;
    const prs = [...(pr ?? "").matchAll(/\[#(\d+)\]/g)].map((m) => Number(m[1]));
    rows.push({ name, status, prs });
  }
  return rows;
}

/** A row has drifted when it links at least one PR and every linked PR has merged. */
export function drifted(row, merged) {
  return row.prs.length > 0 && row.prs.every((n) => merged.has(n));
}

function mergedPrs(numbers) {
  const gh = process.env[GH_ENV] || "gh";
  const merged = new Set();
  for (const n of new Set(numbers)) {
    const r = spawnSync(gh, ["pr", "view", String(n), "-R", REPO, "--json", "state", "-q", ".state"], { encoding: "utf8" });
    if (r.status !== 0) {
      process.stderr.write(`state-drift: gh pr view ${n} failed: ${(r.stderr || "").trim()}\n`);
      process.exit(2);
    }
    if (r.stdout.trim() === "MERGED") merged.add(n);
  }
  return merged;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--")) ?? "docs/progress/STATE.md";
  const rows = movingRows(readFileSync(file, "utf8"));
  const merged = mergedPrs(rows.flatMap((r) => r.prs));
  for (const r of rows) {
    const status = r.status.replace(/\s+/g, " ");
    if (args.includes("--moving")) {
      if (!drifted(r, merged)) console.log(`${r.name} | ${status}`);
    } else if (drifted(r, merged)) {
      console.log(`${r.name} — STATE says ${status}; ${r.prs.map((n) => `#${n}`).join(", ")} merged`);
    }
  }
}
