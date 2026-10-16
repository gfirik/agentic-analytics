#!/usr/bin/env bash
# Records docs/assets/readme/demo.gif (docs/DOCS-SITE.md §3.2): VHS records the terminal from demo.tape, Playwright
# records the report clip, and ffmpeg joins them into one palette-optimised GIF (under 5 MB, at most 30 s).
# Needs vhs (+ ttyd, ffmpeg) and a Playwright browser (PW_CHANNEL=chrome to use an installed Chrome). See D15.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK=/tmp/aa-demo
find "$WORK" -delete 2>/dev/null || true
mkdir -p "$WORK/bin" "$WORK/clip"
# `aa` on PATH, and a no-op opener so --open doesn't launch a browser during the recording.
printf '#!/usr/bin/env bash\nexec node "%s/apps/cli/bin/aa.js" "$@"\n' "$ROOT" > "$WORK/bin/aa"
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/bin/xdg-open"
chmod +x "$WORK/bin/aa" "$WORK/bin/xdg-open"

cd "$WORK"
AA_DEMO_ROOT="$ROOT" vhs "$ROOT/scripts/readme-assets/demo.tape"
REPORT="$ROOT/agentic-analytics/report.html"
(cd "$ROOT" && node --import tsx scripts/readme-assets/report-clip.ts "$REPORT" "$WORK/clip")
CLIP="$(ls "$WORK"/clip/*.webm | head -1)"

# Same size and rate, then one palette for both parts.
ffmpeg -loglevel error -y -i "$WORK/demo-terminal.mp4" -i "$CLIP" -filter_complex \
  "[0:v]fps=8,scale=900:-2:flags=lanczos,setsar=1[a];[1:v]fps=8,scale=900:-2:flags=lanczos,setsar=1[b];[a][b]concat=n=2:v=1[v];[v]split[x][y];[x]palettegen=max_colors=96:stats_mode=diff[p];[y][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  "$ROOT/docs/assets/readme/demo.gif"
find "$ROOT/agentic-analytics" -delete
ls -la "$ROOT/docs/assets/readme/demo.gif"
