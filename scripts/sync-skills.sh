#!/usr/bin/env bash
# Sync the agent skills used to develop this plugin into .agents/skills/
# (.claude/skills is a symlink to it). Run by `npm install` (postinstall).
#
# Skills come from the upstream NousResearch/hermes-agent repo on GitHub.
# `hermes-plugin-development` is not published upstream, so it is copied from
# the local Hermes home when present. Never fails the install: a skill that
# cannot be fetched is reported and skipped. Set SKIP_SKILLS_SYNC=1 to skip.

set -u

if [ -n "${SKIP_SKILLS_SYNC:-}" ]; then
  echo "skills:sync: skipped (SKIP_SKILLS_SYNC)"
  exit 0
fi

UPSTREAM="https://github.com/NousResearch/hermes-agent/tree/main"
GITHUB_SKILLS=(
  skills/autonomous-ai-agents/hermes-agent
  skills/software-development/inspecting-hermes-desktop-dom
)
LOCAL_DIR="${HERMES_HOME:-$HOME/.hermes}/skills/software-development"
LOCAL_SKILLS=(
  hermes-plugin-development
)

add() { # <source> [extra args...]
  if skills add "$@" -a universal -y >/dev/null 2>&1; then
    echo "skills:sync: ✓ $1"
  else
    echo "skills:sync: ✗ $1 (skipped)"
  fi
}

# One sparse fetch per skill. Sequential: each `skills add` rewrites
# skills-lock.json, so parallel runs would race on it.
for path in "${GITHUB_SKILLS[@]}"; do
  add "$UPSTREAM/$path"
done

if [ -d "$LOCAL_DIR" ]; then
  for name in "${LOCAL_SKILLS[@]}"; do
    add "$LOCAL_DIR" -s "$name"
  done
else
  echo "skills:sync: $LOCAL_DIR not found, skipping local skills"
fi

exit 0
