#!/usr/bin/env bash
# Stop hook: don't let Claude finish a turn with a red gate on a milestone branch.
# Exit 2 = block stopping and feed the reason back to Claude.
input=$(cat)
echo "$input" | grep -q '"stop_hook_active":[[:space:]]*true' && exit 0   # avoid infinite loops
[ -f package.json ] || exit 0
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
case "$branch" in m[0-9]*/*) ;; *) exit 0 ;; esac
git diff --quiet main...HEAD -- . ':!docs' 2>/dev/null && git diff --quiet 2>/dev/null && exit 0  # no code changes
# One heavy job at a time on the machine (AGENTS.md §9): when another one holds the lock, skip this turn's check
# rather than wait inside the hook (the gate runs again at the end of the next turn, and before every push).
run=(bun run check)
[ -f scripts/heavy.sh ] && run=(bash scripts/heavy.sh --if-free bun run check)
out=$("${run[@]}" 2>&1)
status=$?
if [ "$status" = 75 ]; then
  echo "Stop hook: another heavy job is running on this machine; skipped the check this turn." >&2
  exit 0
fi
if [ "$status" != 0 ]; then
  echo "Quality gate failed on $branch. Fix before finishing:" >&2
  echo "$out" | tail -40 >&2
  exit 2
fi
exit 0
