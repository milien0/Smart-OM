#!/usr/bin/env bash
# Smart-OM loop runner: fresh context each turn, state on disk.
# Requires PROMPT.md to have a real goal in it (not the template placeholder).
#
# Windows: run this from Git Bash or WSL. For unattended scheduling, use
# Windows Task Scheduler (Action: bash, Arguments: -lc "cd /path/to/Smart-OM && ./run.sh")
# instead of cron, which isn't available natively.
set -euo pipefail

mkdir -p logs
cd "$(dirname "$0")"

if grep -q "Fill this in per loop run" PROMPT.md; then
  echo "PROMPT.md still has the template placeholder — write a real goal before looping." >&2
  exit 1
fi

while true; do
  ts=$(date +%Y-%m-%d_%H-%M-%S)

  # plan + act, fresh context
  claude -p "Read PROMPT.md and IMPLEMENTATION_PLAN.md. Do the next step toward the goal. Update IMPLEMENTATION_PLAN.md's checklist and log as you go. Commit on green." \
    >> "logs/${ts}.log" 2>&1

  # verify, separate fresh context via the verifier subagent
  if claude -p "/verify" >> "logs/${ts}.log" 2>&1; then
    echo "[$ts] iter ok" | tee -a "logs/${ts}.log"
  else
    echo "[$ts] verify failed, will retry" | tee -a "logs/${ts}.log"
  fi

  grep -q "^STATUS: done$" IMPLEMENTATION_PLAN.md && break
  sleep 5
done

echo "Goal complete. See IMPLEMENTATION_PLAN.md and logs/."
