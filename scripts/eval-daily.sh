#!/usr/bin/env bash
# One pass of a real-model eval suite per day (M13h), instead of retrying every 30 minutes: free tiers have daily
# token quotas (Groq: 200k tokens/day for the planner model), so a pass right after the quota resets finishes as many
# businesses as the day allows. Every finished call is served from evals/.cache, and since M13h a cached answer is
# served even while the route is rate-limited, so each pass replays the businesses finished before for free and only
# spends quota on new ones. The models never change between passes.
#
# Usage: bash scripts/eval-daily.sh <smoke|full> [extra aa eval args...]
#   e.g. bash scripts/eval-daily.sh full --small-model --keep-reports data/eval-reports
# Schedule it once a day, at least 24 h after the previous pass (Groq's daily token limit is a rolling window;
# docs/EVALS.md §4), e.g. with cron. Cron's PATH is minimal, so give it the directories of bun and node:
#   30 1 * * * cd /path/to/agentic-analytics && PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin" bash scripts/eval-daily.sh full --small-model --keep-reports data/eval-reports
# The pass runs as a heavy job (scripts/heavy.sh: one at a time on the machine, AGENTS.md §9). Results land in
# evals/results and the README table as a partial run until every job finishes; a maintainer commits them in a PR.
set -uo pipefail
cd "$(dirname "$0")/.."
suite="${1:?usage: eval-daily.sh <smoke|full> [args...]}"
shift
mkdir -p data/logs
log="data/logs/eval-${suite}-$(date -u +%F).log"
echo "[$(date -u +%FT%TZ)] bun run eval -- --suite ${suite} --model configured $*" | tee "$log"
bash scripts/heavy.sh bun run eval -- --suite "$suite" --model configured "$@" >>"$log" 2>&1
status=$?
# The eval rewrote evals/RESULTS.md; the README table is generated from evals/results: keep it in step with the pass.
bun run readme:assets >/dev/null 2>&1 || true
jobs=$(grep -cE '^\[[0-9]+/[0-9]+\]' "$log" || true)
done_jobs=$(grep -E '^\[[0-9]+/[0-9]+\]' "$log" | grep -vc ': failed' || true)
limited=$(grep -cE 'failed \((RATE_LIMITED|PROVIDER: .*(429|Rate limit|rate limit))' "$log" || true)
other=$((jobs - done_jobs - limited))
summary="eval ${suite} (daily pass): ${done_jobs} of ${jobs} jobs finished, ${limited} stopped on the rate limit, ${other} failed otherwise (log: ${log})"
echo "$summary"
bash scripts/notify.sh "$summary"
exit "$status"
