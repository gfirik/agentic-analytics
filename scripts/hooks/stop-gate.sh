#!/usr/bin/env bash
# Stop hook: don't let Claude finish a turn with a red gate on a milestone branch.
# Exit 2 = block stopping and feed the reason back to Claude.
input=$(cat)
echo "$input" | grep -q '"stop_hook_active":[[:space:]]*true' && exit 0   # avoid infinite loops
[ -f package.json ] || exit 0
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
case "$branch" in m[0-9]*/*) ;; *) exit 0 ;; esac
git diff --quiet main...HEAD -- . ':!docs' 2>/dev/null && git diff --quiet 2>/dev/null && exit 0  # no code changes
if ! out=$(pnpm -s check 2>&1); then
  echo "Quality gate failed on $branch. Fix before finishing:" >&2
  echo "$out" | tail -40 >&2
  exit 2
fi
exit 0
