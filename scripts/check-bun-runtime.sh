#!/usr/bin/env bash
# Probe: can Bun be the *runtime* too (D7, D14)? Runs a DuckDB query under Bun via @duckdb/node-api
# and records the outcome in docs/progress/STATE.md under "Decisions made by agents".
# Usage: bash scripts/check-bun-runtime.sh [--no-record]
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
STATE=docs/progress/STATE.md

probe=$(mktemp -d)
trap 'rm -rf "$probe" packages/store/.bun-runtime-probe.ts' EXIT
cat > "$probe/probe.ts" <<'TS'
import { DuckDBInstance } from "@duckdb/node-api";
const instance = await DuckDBInstance.create(":memory:");
const conn = await instance.connect();
const reader = await conn.runAndReadAll("SELECT version() AS v, sum(x)::INTEGER AS s FROM range(1, 11) t(x)");
const row = reader.getRowObjects()[0];
if (row?.s !== 55) throw new Error(`unexpected sum: ${String(row?.s)}`);
console.log(`duckdb ${String(row?.v)} sum(1..10)=${row?.s}`);
conn.closeSync();
instance.closeSync();
TS
# Resolve @duckdb/node-api from packages/store, where it is a dependency.
cp "$probe/probe.ts" packages/store/.bun-runtime-probe.ts
out=$(cd packages/store && timeout 120 bun run .bun-runtime-probe.ts 2>&1); code=$?
rm -f packages/store/.bun-runtime-probe.ts

bun_v=$(bun --version)
today=$(date +%F)
if [ "$code" -eq 0 ]; then
  verdict="PASS"; detail=$(echo "$out" | tail -1)
else
  verdict="FAIL"; detail=$(echo "$out" | tr '\n' ' ' | cut -c1-200)
fi
echo "bun runtime probe: $verdict — bun $bun_v — $detail"

if [ "${1:-}" != "--no-record" ] && [ -f "$STATE" ]; then
  line="- [runtime-probe] $today — Bun $bun_v as runtime for @duckdb/node-api: $verdict ($detail) — informs whether D7 (Node runtime) can switch to Bun — \`bash scripts/check-bun-runtime.sh\`"
  # Replace any previous probe line, then insert under the "Decisions made by agents" heading.
  node -e '
    const fs = require("fs");
    const [file, line] = process.argv.slice(1);
    let s = fs.readFileSync(file, "utf8").split("\n").filter((l) => !l.startsWith("- [runtime-probe]")).join("\n");
    const h = "## Decisions made by agents\n";
    const i = s.indexOf(h);
    if (i < 0) process.exit(1);
    let rest = s.slice(i + h.length).replace(/^\n_None yet\._\n/, "\n");
    s = s.slice(0, i + h.length) + "\n" + line + rest.replace(/^\n/, "\n");
    fs.writeFileSync(file, s);
  ' "$STATE" "$line" && echo "recorded in $STATE"
fi
exit "$code"
