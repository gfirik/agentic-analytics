#!/usr/bin/env bash
# Reruns a real-model eval suite until no job stops on a provider's rate limit (M13a). Free tiers have daily token
# quotas (Groq: 200k tokens/day per model), so a full suite takes several days; every finished model call is served
# from evals/.cache on the next pass, so each rerun only pays for the jobs that didn't finish. The models never
# change between passes: a job that hits the limit waits for the reset instead of switching models.
#
# Usage: bash scripts/eval-until-done.sh <smoke|full> [extra aa eval args...]
#   e.g. bash scripts/eval-until-done.sh full --small-model --keep-reports data/eval-reports
# Env: AA_EVAL_WAIT_S (seconds between passes, default 1800), AA_EVAL_MAX_PASSES (default 200).
set -uo pipefail
suite="${1:?usage: eval-until-done.sh <smoke|full> [args...]}"
shift
wait_s="${AA_EVAL_WAIT_S:-1800}"
max="${AA_EVAL_MAX_PASSES:-200}"
mkdir -p data/logs
for pass in $(seq 1 "$max"); do
  log="data/logs/eval-${suite}-pass${pass}.log"
  echo "[$(date -u +%FT%TZ)] pass ${pass}: bun run eval -- --suite ${suite} --model configured $*"
  bun run eval -- --suite "$suite" --model configured "$@" >"$log" 2>&1
  grep -E '^\[[0-9]+/[0-9]+\]' "$log"
  if ! grep -qE 'failed \((RATE_LIMITED|PROVIDER: .*(429|Rate limit|rate limit|Cannot connect))' "$log"; then
    grep -E '^(Jobs completed|Planted recall|Distractor FP|Driver accuracy)' "$log"
    bash scripts/notify.sh "eval ${suite}: finished after ${pass} pass(es)"
    exit 0
  fi
  echo "[$(date -u +%FT%TZ)] some jobs hit a rate limit; next pass in ${wait_s} s (finished calls are cached)"
  sleep "$wait_s"
done
bash scripts/notify.sh "eval ${suite}: still rate-limited after ${max} passes"
exit 1
