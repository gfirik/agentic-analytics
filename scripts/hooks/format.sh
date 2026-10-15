#!/usr/bin/env bash
# PostToolUse hook: format the file Claude just edited (silent, never blocks).
f=$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(j.tool_input?.file_path||"")}catch{}})')
case "$f" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.jsonc|*.css)
    [ -x node_modules/.bin/biome ] && node_modules/.bin/biome check --write "$f" >/dev/null 2>&1 || true ;;
esac
exit 0
