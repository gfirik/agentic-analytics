#!/usr/bin/env bash
set -uo pipefail
# Optional free Telegram notification. AA_TG_TOKEN and AA_TG_CHAT come from the shell, or else from
# ~/.config/agentic-analytics/telegram.env (outside the repo, chmod 600; override the path with AA_TG_ENV).
# The values are never printed.
msg="[agentic-analytics] ${1:-update}"
echo "$msg"
envfile="${AA_TG_ENV:-${XDG_CONFIG_HOME:-$HOME/.config}/agentic-analytics/telegram.env}"
if { [ -z "${AA_TG_TOKEN:-}" ] || [ -z "${AA_TG_CHAT:-}" ]; } && [ -r "$envfile" ]; then
  # Only the two expected keys are read; the file is never sourced as a script.
  # A last line without a newline still counts; CR and surrounding quotes are dropped.
  while IFS='=' read -r k v || [ -n "$k" ]; do
    v="${v%$'\r'}"
    v="${v#[\"\']}"
    v="${v%[\"\']}"
    case "$k" in
      AA_TG_TOKEN) [ -n "${AA_TG_TOKEN:-}" ] || AA_TG_TOKEN="$v" ;;
      AA_TG_CHAT) [ -n "${AA_TG_CHAT:-}" ] || AA_TG_CHAT="$v" ;;
    esac
  done <"$envfile"
fi
if [ -n "${AA_TG_TOKEN:-}" ] && [ -n "${AA_TG_CHAT:-}" ]; then
  # The token and chat id go to curl as a config on stdin (-K -), never on its command line, where any local user
  # could read them in the process list.
  if printf 'url = "https://api.telegram.org/bot%s/sendMessage"\ndata-urlencode = "chat_id=%s"\n' "$AA_TG_TOKEN" "$AA_TG_CHAT" |
    curl -s --max-time 15 -K - -o /dev/null -w '%{http_code}' -X POST --data-urlencode "text=${msg}" | grep -q '^200$'; then
    echo "(sent to Telegram)"
  else
    echo "(Telegram send failed)" >&2
  fi
fi
