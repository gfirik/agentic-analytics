#!/usr/bin/env bash
# One deferred real-model run per night (M14's baseline-report runs, queued in evals/deferred.txt and listed in STATE
# "Deferred checks"). It runs on a Groq model the nightly full suite doesn't use (Groq's free quota is per model), so
# the full suite's quota is untouched. The model is picked once (scripts/deferred-model.mjs) and kept in
# data/cron/deferred/model, so every run of the queue, and every retry, uses the same one; set AA_DEFERRED_MODEL to
# choose it yourself.
#
# Usage: bash scripts/eval-deferred.sh   (from cron, after the full suite: heavy.sh waits for its lock)
#   30 3 * * * cd /path/to/agentic-analytics && PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin" bash scripts/eval-deferred.sh
# Each night runs the first entry not yet finished. A run counts as finished when it exits 0 or 1 (1 is a run that
# completed and missed a bar) and nothing in tonight's log hit the rate limit; otherwise it runs again the next night.
# A golden run resumes, since every finished call is served from evals/.cache; an ablation or --repeat run keeps the
# cache off by design (docs/specs/accuracy.md §7, §8), so a retry starts it again. Finished ids go to
# data/cron/deferred/done. Results land in evals/results/<golden|ablation|repeat>/; a maintainer (or the agent)
# publishes them in a PR (STATE "Deferred checks", [M14 PR 8]).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
queue=evals/deferred.txt
state=data/cron/deferred
mkdir -p "$state" data/logs
touch "$state/done"

# Trims surrounding blanks in bash (xargs did this before, and failed on the apostrophe in a comment line).
trim() {
  local s=$1
  s=${s#"${s%%[![:space:]]*}"}
  printf '%s' "${s%"${s##*[![:space:]]}"}"
}
next=""
while IFS='|' read -r id args; do
  id=$(trim "$id")
  [ -z "$id" ] || [[ "$id" == \#* ]] && continue
  if ! grep -qxF "$id" "$state/done"; then
    next="$id|$(trim "$args")"
    break
  fi
done <"$queue"
if [ -z "$next" ]; then
  echo "eval-deferred: every queued run has finished (evals/deferred.txt)"
  exit 0
fi
id=${next%%|*}
args=${next#*|}

if [ -s "$state/model" ]; then
  model=$(cat "$state/model")
elif [ -n "${AA_DEFERRED_MODEL:-}" ]; then
  model=$AA_DEFERRED_MODEL
  echo "$model" >"$state/model"
elif model=$(node scripts/deferred-model.mjs); then
  echo "$model" >"$state/model"
else
  bash scripts/notify.sh "eval deferred: no Groq model picked for tonight's run ($id); it runs again tomorrow night"
  exit 1
fi
route="openai-compatible:groq:${model}"

log="data/logs/eval-deferred-$(date -u +%F).log"
start=0
[ -f "$log" ] && start=$(wc -c <"$log")
# The golden runs read the real data, which is fetched (and checksummed) when missing.
if [[ "$args" == *golden* ]]; then bash scripts/heavy.sh bun run eval:real:fetch >>"$log" 2>&1; fi
read -r -a argv <<<"${args//MODEL/$route}"
echo "[$(date -u +%FT%TZ)] $id: bun run ${argv[*]}" | tee -a "$log"
bash scripts/heavy.sh bun run "${argv[@]}" >>"$log" 2>&1
status=$?
limited=$(tail -c "+$((start + 1))" "$log" | grep -cE 'RATE_LIMITED|429|[Rr]ate limit' || true)
if { [ "$status" -eq 0 ] || [ "$status" -eq 1 ]; } && [ "$limited" -eq 0 ]; then
  echo "$id" >>"$state/done"
  summary="eval deferred: ${id} on ${model} finished (exit ${status}); results in evals/results, to publish in a PR (log: ${log})"
else
  summary="eval deferred: ${id} on ${model} stopped (exit ${status}, ${limited} rate-limit lines); it runs again tomorrow night (log: ${log})"
fi
echo "$summary"
bash scripts/notify.sh "$summary"
exit 0
