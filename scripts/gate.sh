#!/usr/bin/env bash
# Quality gate: everything a PR must pass locally: install, then the checks of `bun run check`. CI runs these and more
# (aa doctor, docker compose config, the browser checks: .github/workflows/ci.yml).
# Bun is the package manager (D14); scripts still execute on Node 22 (D7).
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
# One heavy job at a time on this machine, and only with enough free RAM (scripts/heavy.sh, AGENTS.md §9).
if [ -z "${AA_HEAVY_LOCKED:-}" ] && [ -z "${CI:-}" ]; then exec bash scripts/heavy.sh bash scripts/gate.sh "$@"; fi

if [ ! -f package.json ]; then
  echo "gate: no package.json yet (pre-M0) — nothing to check"; exit 0
fi

step() { echo; echo "── gate: $1"; }

step "install";          bun install --frozen-lockfile >/dev/null
step "check (lint+types+tests+schema drift)"; bun run check
echo; echo "gate: PASS"
