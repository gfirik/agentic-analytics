#!/usr/bin/env bash
# The scheduled real-model eval (docs/EVALS.md §4), run once a day from cron. Every call is live: the response cache
# is off (`--no-cache`), so a pass measures the models as they answer today instead of replaying evals/.cache (until
# 2026-11-16 the nightly replayed it: 811 of 811 calls cached, nothing new measured).
#
#   nightly  a rotating eighth of the full suite (3–4 of the 30 datasets, spread across archetypes): every dataset
#            runs fresh at least once every 8 nights.
#   weekly   the whole full suite (30 datasets), fresh.
#   auto     weekly on AA_WEEKLY_DAY (ISO weekday, default 7 = Sunday, local time), nightly on the other days.
#
# Usage: bash scripts/eval-daily.sh [auto|nightly|weekly] [extra aa eval args...]
#   cron: 0 3 * * * cd /path/to/agentic-analytics && PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin" bash scripts/eval-daily.sh auto
#
# Quota (Groq free tier: 200,000 planner tokens per rolling 24 h). A full run is about 131k planner tokens, a nightly
# eighth about 20–35k. Before it starts, the pass sums the planner tokens the call log (data/logs/model-calls.jsonl)
# shows in the last 24 hours; if that plus this pass's estimate would pass the limit (another run, such as a
# backtest, spent the day), it skips and says so instead of running into the rate limit. Override with
# AA_PLANNER_LIMIT, AA_NIGHTLY_ESTIMATE and AA_WEEKLY_ESTIMATE. The weekly pass is a day of its own: the next
# nightly starts 24 h later, when its tokens have left the window.
#
# Nothing lands in the checkout: results, RESULTS.md and each dataset's report go to data/eval-runs/<mode>-<date>/
# (data/ is gitignored), so the working tree is clean after a pass. To publish a weekly run, copy its results file to
# evals/results in a PR and run `bun run readme:assets`.
#
# The summary (stdout and scripts/notify.sh) gives the job counts, the cache-hit rate and the planner tokens of this
# pass, both read from the part of the call log this pass appended, and the headline rates. The log is one file per
# mode and UTC day, appended to; the counts read only this pass's part of it.
set -uo pipefail
# No -e above (the eval's own status is kept), so a failed cd must stop here, not run the eval in cron's folder.
cd "$(dirname "$0")/.." || exit 1
mode="${1:-auto}"
[ $# -gt 0 ] && shift
today="${AA_TODAY:-$(date +%F)}"
if [ "$mode" = auto ]; then
  if [ "$(date -d "$today" +%u 2>/dev/null || date +%u)" = "${AA_WEEKLY_DAY:-7}" ]; then mode=weekly; else mode=nightly; fi
fi
case "$mode" in
  nightly) estimate="${AA_NIGHTLY_ESTIMATE:-40000}" ;;
  weekly) estimate="${AA_WEEKLY_ESTIMATE:-140000}" ;;
  *)
    echo "usage: eval-daily.sh [auto|nightly|weekly] [args...]" >&2
    exit 2
    ;;
esac
limit="${AA_PLANNER_LIMIT:-200000}"
mkdir -p data/logs
calls_log=data/logs/model-calls.jsonl
log="data/logs/eval-${mode}-$(date -u +%F).log"
out="data/eval-runs/${mode}-${today}"

# Planner tokens of live calls in the call log since $1 (an ISO time), from byte offset $2 on.
planner_tokens() {
  [ -f "$calls_log" ] || {
    echo 0
    return
  }
  tail -c "+$(($2 + 1))" "$calls_log" | awk -v since="$1" '
    /"role":"planner"/ && !/"cached":true/ {
      if (match($0, /"at":"[^"]*"/) && substr($0, RSTART + 6, RLENGTH - 7) < since) next
      t = 0
      if (match($0, /"inputTokens":[0-9]+/)) t += substr($0, RSTART + 14, RLENGTH - 14)
      if (match($0, /"outputTokens":[0-9]+/)) t += substr($0, RSTART + 15, RLENGTH - 15)
      s += t
    }
    END { print s + 0 }'
}
# Thousands separators without relying on the locale (cron and CI run in C).
fmt() {
  local n=$1 s=""
  while [ ${#n} -gt 3 ]; do
    s=",${n: -3}$s"
    n=${n:0:${#n}-3}
  done
  printf '%s' "$n$s"
}

since=$(node -e 'console.log(new Date(Date.now() - 864e5).toISOString())')
used=$(planner_tokens "$since" 0)
if [ $((used + estimate)) -gt "$limit" ]; then
  summary="eval ${mode} skipped: $(fmt "$used") planner tokens used in the last 24 h + about $(fmt "$estimate") for this pass would pass the $(fmt "$limit") free-tier limit"
  echo "[$(date -u +%FT%TZ)] $summary" >>"$log"
  echo "$summary"
  bash scripts/notify.sh "$summary"
  exit 0
fi

only=()
all=$(for d in evals/datasets/generated/*/; do basename "$d"; done | sort)
total=$(echo "$all" | grep -c .)
scope="all ${total} datasets"
if [ "$mode" = nightly ]; then
  # Every 8th dataset of the sorted list, offset by the day: consecutive nights cover different archetypes.
  day=$(node -e 'console.log(Math.floor(Date.parse(process.argv[1]) / 864e5))' "$today")
  ids=$(echo "$all" | awk -v g=$((day % 8)) '(NR - 1) % 8 == g' | paste -sd, -)
  only=(--only "$ids")
  scope="$(echo "$ids" | tr ',' '\n' | grep -c .) of ${total} datasets: ${ids//,/, }"
fi

start=0
[ -f "$log" ] && start=$(wc -c <"$log")
cstart=0
[ -f "$calls_log" ] && cstart=$(wc -c <"$calls_log")
this_run() { tail -c "+$((start + 1))" "$log"; }
args=(--suite full --model configured --small-model --no-cache "${only[@]}" --results-dir "$out" --keep-reports "$out/reports" "$@")
echo "[$(date -u +%FT%TZ)] bun run eval -- ${args[*]}" | tee -a "$log"
bash scripts/heavy.sh bun run eval -- "${args[@]}" >>"$log" 2>&1
status=$?

jobs=$(this_run | grep -cE '^\[[0-9]+/[0-9]+\]' || true)
done_jobs=$(this_run | grep -E '^\[[0-9]+/[0-9]+\]' | grep -vc ': failed' || true)
limited=$(this_run | grep -E '^\[[0-9]+/[0-9]+\]' | grep -cE 'failed \((RATE_LIMITED|PROVIDER: .*(429|Rate limit|rate limit))' || true)
other=$((jobs - done_jobs - limited))
if [ "$other" -lt 0 ]; then other=0; fi
calls=0
hits=0
if [ -f "$calls_log" ]; then
  calls=$(tail -c "+$((cstart + 1))" "$calls_log" | grep -c '"role":' || true)
  hits=$(tail -c "+$((cstart + 1))" "$calls_log" | grep -c '"cached":true' || true)
fi
rate="n/a"
[ "$calls" -gt 0 ] && rate="$((hits * 100 / calls))%"
spent=$(planner_tokens "" "$cstart")
rates=$(this_run | grep -E '^(Planted recall@5|Driver accuracy|Number mismatches): ' | sed 's/ (bar.*//' | paste -sd, - | sed 's/,/, /g')
summary="eval ${mode} (fresh, ${scope}): ${done_jobs} of ${jobs} jobs finished, ${limited} stopped on the rate limit, ${other} failed otherwise; cache hits ${hits} of ${calls} calls (${rate}); $(fmt "$spent") planner tokens${rates:+; ${rates}} (results: ${out}; log: ${log})"
echo "$summary"
bash scripts/notify.sh "$summary"
exit "$status"
