#!/usr/bin/env bash
# Runs one heavy job (gate, full tests, builds, evals, Playwright) at a time on this machine, across every worktree
# and agent (AGENTS.md §9): it takes a machine-wide lock, and waits until about 1.5 GB of RAM is available before
# starting. Nested calls (gate.sh running evals) reuse the lock they already hold.
#
# Usage: bash scripts/heavy.sh [--if-free] <command> [args...]
#   --if-free  don't wait: if another heavy job holds the lock or RAM is short, exit 75 without running (the Stop
#              hook skips its check then)
# Env: AA_HEAVY_MIN_MB (default 1500), AA_HEAVY_LOCK (default /tmp/agentic-analytics-heavy.lock: one fixed path, so
# every shell on the machine shares it).
#
# The lock is an inherited file descriptor: a process the job leaves running (a preview server, a stray test worker)
# keeps holding it, and the wait message names the holders.
set -euo pipefail
if_free=0
if [ "${1:-}" = "--if-free" ]; then
  if_free=1
  shift
fi
[ "$#" -gt 0 ] || { echo "usage: heavy.sh [--if-free] <command> [args...]" >&2; exit 2; }

# Already inside a heavy job (nested call), or on CI (one job per runner): just run.
if [ -n "${AA_HEAVY_LOCKED:-}" ] || [ -n "${CI:-}" ]; then exec "$@"; fi
export AA_HEAVY_LOCKED=1

if command -v flock >/dev/null; then
  lock="${AA_HEAVY_LOCK:-/tmp/agentic-analytics-heavy.lock}"
  exec 9>>"$lock"
  if ! flock -n 9; then
    holders=$(command -v fuser >/dev/null && fuser "$lock" 2>/dev/null | tr -s ' ' | sed 's/^ //' || true)
    if [ "$if_free" = 1 ]; then
      echo "heavy: another heavy job is running on this machine${holders:+ (pids: $holders)}; skipped" >&2
      exit 75
    fi
    echo "heavy: another heavy job is running on this machine${holders:+ (pids: $holders)}; waiting for it to finish" >&2
    flock 9
  fi
else
  echo "heavy: no flock on this machine; running without the machine-wide lock" >&2
fi

available_mb() {
  local mb
  mb=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null || true)
  echo "${mb:-0}"
}
min="${AA_HEAVY_MIN_MB:-1500}"
case "$min" in '' | *[!0-9]*) min=1500 ;; esac
if [ -r /proc/meminfo ] && [ "$min" -gt 0 ]; then
  for i in $(seq 1 60); do
    [ "$(available_mb)" -ge "$min" ] && break
    if [ "$if_free" = 1 ]; then
      echo "heavy: only $(available_mb) MB of RAM available (want ${min}); skipped" >&2
      exit 75
    fi
    if [ "$i" = 60 ]; then
      echo "heavy: still only $(available_mb) MB of RAM available after 30 min; starting anyway" >&2
      break
    fi
    echo "heavy: only $(available_mb) MB of RAM available (want ${min}); waiting 30 s" >&2
    sleep 30
  done
fi
exec "$@"
