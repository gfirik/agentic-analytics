#!/usr/bin/env bash
# Optional free Telegram notification. Set AA_TG_TOKEN and AA_TG_CHAT in your shell (never in the repo).
msg="[agentic-analytics] ${1:-update}"
echo "$msg"
if [ -n "${AA_TG_TOKEN:-}" ] && [ -n "${AA_TG_CHAT:-}" ]; then
  curl -s -o /dev/null -X POST "https://api.telegram.org/bot${AA_TG_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${AA_TG_CHAT}" --data-urlencode "text=${msg}" || true
fi
