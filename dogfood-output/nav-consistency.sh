#!/usr/bin/env bash
set -euo pipefail

export AGENT_BROWSER_CONFIG=/home/shuv/repos/better-hub/dogfood-output/agent-browser-headless.json
export AGENT_BROWSER_EXECUTABLE_PATH=/home/shuv/.agent-browser/browsers/chrome-150.0.7871.24/chrome
SESSION="better-hub-cache-dogfood"
OUT="/home/shuv/repos/better-hub/dogfood-output"
BASE="http://127.0.0.1:3000/shuv1337/better-hub"

pages=(overview code issues pulls actions activity overview)
urls=("$BASE" "$BASE/code" "$BASE/issues" "$BASE/pulls" "$BASE/actions" "$BASE/activity" "$BASE")

for i in "${!pages[@]}"; do
  page="${pages[$i]}"
  url="${urls[$i]}"
  idx=$((i+1))
  echo "=== Nav $idx: $page ==="
  agent-browser --session "$SESSION" open "$url" >/dev/null
  agent-browser --session "$SESSION" wait --load networkidle >/dev/null || agent-browser --session "$SESSION" wait 5000
  agent-browser --session "$SESSION" screenshot "$OUT/screenshots/cache-nav-better-hub-${page}.png" >/dev/null
  agent-browser --session "$SESSION" console > "$OUT/benchmarks/console-nav-better-hub-${page}.txt" 2>&1 || true
  agent-browser --session "$SESSION" errors > "$OUT/benchmarks/errors-nav-better-hub-${page}.txt" 2>&1 || true
  echo "done $page"
done