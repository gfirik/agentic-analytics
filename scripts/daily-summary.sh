#!/usr/bin/env bash
# Daily plain-words Telegram summary (maintainer's standing instruction, 2026-10-21): what merged in the last
# 24 hours, what is open, what is in progress, the nightly's last line, and anything waiting on the maintainer.
# Read-only on the repo. "In progress" is STATE.md's moving rows cross-checked against GitHub
# (scripts/state-drift.mjs): a row whose PRs have all merged is left out and named under "STATE drift" instead, so a
# stale row shows up the next morning rather than passing for work in progress.
#
# Usage, from the system crontab (logs to data/logs/daily-summary.log):
#   47 20 * * * cd /path/to/agentic-analytics && PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin" bash scripts/daily-summary.sh >> data/logs/daily-summary.log 2>&1
# DRY=1 prints instead of sending. AA_GH names the gh binary (tests use a stand-in).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
gh=${AA_GH:-gh}
echo "[$(date -u +%FT%TZ)] daily summary"
git fetch -q origin 2>/dev/null || echo "git fetch failed; using the last fetched origin/main"
since=$(date -u -d '24 hours ago' +%FT%TZ)
merged=$("$gh" pr list -R gfirik/agentic-analytics --state merged --search "merged:>=$since" --limit 30 \
  --json number,title -q '.[] | "#\(.number) \(.title)"' 2>/dev/null | cut -c1-90)
open=$("$gh" pr list -R gfirik/agentic-analytics --state open --limit 10 \
  --json number,title,isDraft -q '.[] | "#\(.number)\(if .isDraft then " (draft)" else "" end) \(.title)"' 2>/dev/null | cut -c1-90)
state_file=$(mktemp)
trap 'rm -f "$state_file"' EXIT
git show origin/main:docs/progress/STATE.md > "$state_file" 2>/dev/null || cp docs/progress/STATE.md "$state_file"
# Rows still moving, cross-checked against merged PRs; if GitHub can't be asked, STATE alone, marked unchecked.
if moving=$(AA_GH="$gh" node scripts/state-drift.mjs "$state_file" --moving 2>/dev/null); then
  drift=$(AA_GH="$gh" node scripts/state-drift.mjs "$state_file" 2>/dev/null)
else
  moving="$(grep -E '^\| [^|]+ \| (IN_PROGRESS|IN_REVIEW|AWAITING_REVIEW|BLOCKED)' "$state_file" | cut -d'|' -f2,3 | sed 's/  */ /g') (not checked against GitHub)"
  drift="not checked (gh failed)"
fi
moving=$(printf '%s\n' "$moving" | cut -c1-90)
drift=$(printf '%s\n' "$drift" | cut -c1-110)
# Items that wait on the maintainer's explicit yes (tags, releases, settings, money).
needsyes=$(grep -iE 'needs (the maintainer.s|your) (explicit )?yes' "$state_file" | cut -c1-110)
nightly_log=$(ls -t data/logs/eval-full-*.log 2>/dev/null | head -1)
nightly=$( [ -n "$nightly_log" ] && grep -E 'combined:|Planted recall|partial|in progress|RATE_LIMITED' "$nightly_log" | tail -2 | cut -c1-110 )
msg="Daily summary $(date +%F)
Merged (24h): ${merged:-nothing}
Open PRs: ${open:-none}
In progress: ${moving:-nothing listed}
STATE drift: ${drift:-none}
Nightly (${nightly_log##*/}): ${nightly:-no log}
Needs your yes: ${needsyes:-nothing}"
if [ "${DRY:-0}" = 1 ]; then printf '%s\n' "$msg"; else bash scripts/notify.sh "$msg"; fi
