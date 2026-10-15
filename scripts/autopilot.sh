#!/usr/bin/env bash
# Outer loop: runs /autopilot headless with a fresh Claude Code session per milestone
# until every milestone is DONE, or one is BLOCKED / AWAITING_REVIEW.
set -uo pipefail
cd "$(dirname "$0")/.."
STATE=docs/progress/STATE.md
MAX_RUNS=${MAX_RUNS:-30}
mkdir -p .autopilot

for i in $(seq 1 "$MAX_RUNS"); do
  if grep -Eq '\|[[:space:]]*(BLOCKED|AWAITING_REVIEW)[[:space:]]*\|' "$STATE"; then
    bash scripts/notify.sh "Autopilot paused — a milestone needs you (see docs/progress/STATE.md)"; exit 0
  fi
  if ! grep -Eq '\|[[:space:]]*(TODO|IN_PROGRESS)[[:space:]]*\|' "$STATE"; then
    bash scripts/notify.sh "Roadmap complete"; exit 0
  fi

  echo "── autopilot run $i ($(date '+%F %T'))"
  claude -p "/autopilot" --permission-mode acceptEdits 2>&1 | tee ".autopilot/run-$(date +%Y%m%d-%H%M%S).log"
  code=${PIPESTATUS[0]}

  git switch main -q 2>/dev/null && git pull --ff-only -q 2>/dev/null || true

  if [ "$code" -ne 0 ]; then
    bash scripts/notify.sh "Claude exited with code $code (limit or error). Retrying in 30 min."
    sleep 1800
  fi
done
bash scripts/notify.sh "Autopilot stopped after $MAX_RUNS runs"
