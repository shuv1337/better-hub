#!/usr/bin/env bash
# Benchmark a repo overview navigation
# Usage: benchmark-nav.sh <scenario> <owner> <repo> <run> <screenshot_prefix>
set -euo pipefail

export AGENT_BROWSER_CONFIG=/home/shuv/repos/better-hub/dogfood-output/agent-browser-headless.json
export AGENT_BROWSER_EXECUTABLE_PATH=/home/shuv/.agent-browser/browsers/chrome-150.0.7871.24/chrome
SESSION="better-hub-cache-dogfood"
OUT="/home/shuv/repos/better-hub/dogfood-output"

SCENARIO="$1"
OWNER="$2"
REPO="$3"
RUN="$4"
PREFIX="$5"
URL="http://127.0.0.1:3000/${OWNER}/${REPO}"
TIMING_FILE="$OUT/benchmarks/timing-${SCENARIO}-${REPO}-run-${RUN}.txt"
CONSOLE_FILE="$OUT/benchmarks/console-${SCENARIO}-${REPO}-run-${RUN}.txt"
SCREENSHOT="$OUT/screenshots/${PREFIX}-${REPO}-run-${RUN}.png"

START_MS=$(date +%s%3N)

agent-browser --session "$SESSION" open "$URL" >/dev/null

# Primary: wait for repo header / overview marker
PRIMARY_START=$(date +%s%3N)
agent-browser --session "$SESSION" wait --text "$REPO" 2>/dev/null || agent-browser --session "$SESSION" wait --text "$OWNER" 2>/dev/null || agent-browser --session "$SESSION" wait 5000
PRIMARY_END=$(date +%s%3N)
VISIBLE_MS=$((PRIMARY_END - PRIMARY_START))

# Secondary: networkidle
NET_START=$(date +%s%3N)
agent-browser --session "$SESSION" wait --load networkidle 2>/dev/null || true
NET_END=$(date +%s%3N)
NETWORK_MS=$((NET_END - NET_START))

TOTAL_MS=$((NET_END - START_MS))

agent-browser --session "$SESSION" screenshot "$SCREENSHOT" >/dev/null
# Note: console capture is cumulative for the browser session. Post-process with
# anchor slicing (last exact [view] URL) for per-run errors; see timing file headers.
agent-browser --session "$SESSION" console > "$CONSOLE_FILE" 2>&1 || true
ERRORS=$(agent-browser --session "$SESSION" errors 2>&1 || true)

{
  echo "scenario=$SCENARIO"
  echo "owner=$OWNER"
  echo "repo=$REPO"
  echo "run=$RUN"
  echo "url=$URL"
  echo "navigation_start_ms=$START_MS"
  echo "visible_content_ms=$VISIBLE_MS"
  echo "network_idle_ms=$NETWORK_MS"
  echo "total_ms=$TOTAL_MS"
  echo "screenshot=$SCREENSHOT"
  echo "console_file=$(basename "$CONSOLE_FILE")"
  echo "# Slice per-run errors from console_file using last [view] $URL anchor"
  echo "---errors---"
  echo "$ERRORS"
} > "$TIMING_FILE"

echo "VISIBLE_MS=$VISIBLE_MS NETWORK_MS=$NETWORK_MS TOTAL_MS=$TOTAL_MS"
echo "$TIMING_FILE"
echo "$SCREENSHOT"