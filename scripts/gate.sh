#!/usr/bin/env bash
# Quality gate: everything a PR must pass. Same checks CI runs.
# Bun is the package manager (D14); scripts still execute on Node 22 (D7).
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

if [ ! -f package.json ]; then
  echo "gate: no package.json yet (pre-M0) — nothing to check"; exit 0
fi

step() { echo; echo "── gate: $1"; }
has_script() { node -e "process.exit(require('./package.json').scripts?.['$1']?0:1)"; }

step "install";          bun install --frozen-lockfile >/dev/null
step "check (lint+types+tests+schema drift)"; bun run check
if has_script build;      then step "build";       bun run build; fi
if has_script eval:smoke; then step "smoke evals"; bun run eval:smoke; fi
echo; echo "gate: PASS"
