#!/usr/bin/env sh
set -e

# Ensure a writable global gitconfig under persisted volume
export GIT_CONFIG_GLOBAL="/data/gitconfig"
mkdir -p /data
touch "$GIT_CONFIG_GLOBAL"

# Allow repos under /repos to be treated as safe (ownership check bypass)
git config --global --add safe.directory /repos || true
git config --global --add safe.directory /repos/* || true
# As a catch‑all, allow any (optional; comment if you prefer strictness)
git config --global --add safe.directory '*' || true

exec /usr/local/bin/vibe-kanban

