#!/usr/bin/env bash
# Quality gate: everything a PR must pass. Same checks CI runs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

if [ ! -f package.json ]; then
  echo "gate: no package.json yet (pre-M0) — nothing to check"; exit 0
fi

step() { echo; echo "── gate: $1"; }
has_script() { node -e "process.exit(require('./package.json').scripts?.['$1']?0:1)"; }

step "install";          pnpm i --frozen-lockfile --prefer-offline >/dev/null
step "check (lint+types+tests+schema drift)"; pnpm -s check
if has_script build;      then step "build";       pnpm -s build; fi
if has_script eval:smoke; then step "smoke evals"; pnpm -s eval:smoke; fi
echo; echo "gate: PASS"
