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
#   0 3 * * * cd /path/to/agentic-analytics && PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin" bash scripts/eval-daily.sh full --small-model --keep-reports data/eval-reports
# Cron uses local time: pick the hour from the last pass's UTC time in data/logs (e.g. 03:00 at UTC+5 is 22:00Z).
# Two passes per run (--passes 2, docs/EVALS.md §4): a free tier's daily quota covers about 21 of the 30 businesses
# (2026-10-19: Groq's 200k tokens/day for the planner ran out at job 22). The first night runs every business; if the
# quota stops some, the next night resumes that result and runs only those, so the two nights' passes make one run.
# A job finished on either night counts as finished; the run is labelled partial only when jobs are still unfinished
# after the second pass. The night after a closed run starts a new one. The row is named after the configured
# routes (aa eval names a `configured` run that way); add --label/--note to override.
# The second night's combined file replaces the first night's: the first file is deleted, so if it was committed the
# checkout shows a tracked deletion; commit it with the combined file. A first night whose second never came is
# rewritten closed (partial) by the next run.
# The pass runs as a heavy job (scripts/heavy.sh: one at a time on the machine, AGENTS.md §9). Results land in
# evals/results and the README table; a maintainer commits them in a PR.
set -uo pipefail
cd "$(dirname "$0")/.."
suite="${1:?usage: eval-daily.sh <smoke|full> [args...]}"
shift
mkdir -p data/logs
log="data/logs/eval-${suite}-$(date -u +%F).log"
passes=(--passes 2)
for a in "$@"; do [ "$a" = "--passes" ] || [[ "$a" == --passes=* ]] && passes=(); done
echo "[$(date -u +%FT%TZ)] bun run eval -- --suite ${suite} --model configured ${passes[*]} $*" | tee -a "$log"
bash scripts/heavy.sh bun run eval -- --suite "$suite" --model configured "${passes[@]}" "$@" >>"$log" 2>&1
status=$?
# The eval rewrote evals/RESULTS.md; the README table is generated from evals/results: keep it in step with the pass.
bun run readme:assets >/dev/null 2>&1 || true
jobs=$(grep -cE '^\[[0-9]+/[0-9]+\]' "$log" || true)
done_jobs=$(grep -E '^\[[0-9]+/[0-9]+\]' "$log" | grep -vc ': failed' || true)
limited=$(grep -E '^\[[0-9]+/[0-9]+\]' "$log" | grep -cE 'failed \((RATE_LIMITED|PROVIDER: .*(429|Rate limit|rate limit))' || true)
other=$((jobs - done_jobs - limited))
if [ "$other" -lt 0 ]; then other=0; fi
# The run as a whole (this pass plus the one it resumed), from the eval's own "combined:" line.
combined=$(grep -E '^combined: ' "$log" | tail -n 1)
summary="eval ${suite} (daily pass): ${done_jobs} of ${jobs} jobs run tonight finished, ${limited} stopped on the rate limit, ${other} failed otherwise${combined:+; ${combined}} (log: ${log})"
echo "$summary"
bash scripts/notify.sh "$summary"
exit "$status"
