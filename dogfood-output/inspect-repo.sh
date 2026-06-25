#!/usr/bin/env bash
# Inspect repo cache status on debug page
# Usage: inspect-repo.sh <owner> <repo> <screenshot_name>
set -euo pipefail

export AGENT_BROWSER_CONFIG=/home/shuv/repos/better-hub/dogfood-output/agent-browser-headless.json
export AGENT_BROWSER_EXECUTABLE_PATH=/home/shuv/.agent-browser/browsers/chrome-150.0.7871.24/chrome
SESSION="better-hub-cache-dogfood"
OUT="/home/shuv/repos/better-hub/dogfood-output"

OWNER="$1"
REPO="$2"
SHOT="$3"

agent-browser --session "$SESSION" open http://127.0.0.1:3000/debug/github-cache >/dev/null
agent-browser --session "$SESSION" wait --load networkidle >/dev/null
agent-browser --session "$SESSION" press Escape 2>/dev/null || true
agent-browser --session "$SESSION" wait 500

agent-browser --session "$SESSION" snapshot -i >/tmp/ab-snap.txt
OWNER_REF=$(grep 'textbox "owner"' /tmp/ab-snap.txt | sed -n 's/.*ref=\(e[0-9]*\).*/\1/p' | head -1)
REPO_REF=$(grep 'textbox "repo"' /tmp/ab-snap.txt | sed -n 's/.*ref=\(e[0-9]*\).*/\1/p' | head -1)
INSPECT_REF=$(grep 'button "Inspect"' /tmp/ab-snap.txt | sed -n 's/.*ref=\(e[0-9]*\).*/\1/p' | head -1)

agent-browser --session "$SESSION" fill "@$OWNER_REF" "$OWNER"
agent-browser --session "$SESSION" fill "@$REPO_REF" "$REPO"
agent-browser --session "$SESSION" click "@$INSPECT_REF"
agent-browser --session "$SESSION" wait 2000

agent-browser --session "$SESSION" screenshot --full "$OUT/screenshots/$SHOT" >/dev/null
agent-browser --session "$SESSION" snapshot 2>&1 | tee "$OUT/benchmarks/inspector-${REPO}-$(echo "$SHOT" | sed 's/cache-inspector-//;s/.png//').txt" | tail -80