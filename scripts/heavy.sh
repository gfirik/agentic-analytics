#!/usr/bin/env bash
# Runs one heavy job (gate, full tests, builds, evals, Playwright) at a time on this machine, across every worktree
# and agent (AGENTS.md §9): it takes a machine-wide lock, and waits until about 1.5 GB of RAM is available before
# starting. Nested calls (gate.sh running evals) reuse the lock they already hold.
#
# Usage: bash scripts/heavy.sh <command> [args...]
# Env: AA_HEAVY_MIN_MB (default 1500), AA_HEAVY_LOCK (default $XDG_RUNTIME_DIR or /tmp, agentic-analytics-heavy.lock).
set -euo pipefail
[ "$#" -gt 0 ] || { echo "usage: heavy.sh <command> [args...]" >&2; exit 2; }

available_mb() { awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null || echo 0; }

if [ -z "${AA_HEAVY_LOCKED:-}" ] && [ -z "${CI:-}" ] && command -v flock >/dev/null; then
  lock="${AA_HEAVY_LOCK:-${XDG_RUNTIME_DIR:-/tmp}/agentic-analytics-heavy.lock}"
  exec 9>"$lock"
  if ! flock -n 9; then
    echo "heavy: another heavy job is running on this machine; waiting for it to finish" >&2
    flock 9
  fi
  export AA_HEAVY_LOCKED=1
  if [ -r /proc/meminfo ]; then
    min="${AA_HEAVY_MIN_MB:-1500}"
    for _ in $(seq 1 60); do
      [ "$(available_mb)" -ge "$min" ] && break
      echo "heavy: only $(available_mb) MB of RAM available (want ${min}); waiting 30 s" >&2
      sleep 30
    done
  fi
fi
exec "$@"
