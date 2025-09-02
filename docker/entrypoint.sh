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

# Preflight diagnostics for common permission issues
echo "[entrypoint] Running as: $(id)"
echo "[entrypoint] Checking /data permissions..."
ls -ld /data || true
ls -la /data || true
if [ ! -w /data ]; then
  echo "[entrypoint][fatal] /data is not writable by current user."
  echo "Fix: chown -R \'$(id -u):$(id -g)\' ./data on the host or run 'make fix-perms'."
  exit 1
fi

if [ -e /data/config.json ] && [ ! -w /data/config.json ]; then
  echo "[entrypoint][fatal] /data/config.json exists but is not writable."
  echo "Owner/mode:" && ls -l /data/config.json || true
  echo "Fix: chown the file on host: sudo chown $(id -u):$(id -g) data/config.json"
  exit 1
fi

if [ -e /data/profiles.json ] && [ ! -w /data/profiles.json ]; then
  echo "[entrypoint][fatal] /data/profiles.json exists but is not writable."
  echo "Owner/mode:" && ls -l /data/profiles.json || true
  echo "Fix: chown the file on host: sudo chown $(id -u):$(id -g) data/profiles.json"
  exit 1
fi

if [ -e /data/db.sqlite ] && [ ! -w /data/db.sqlite ]; then
  echo "[entrypoint][fatal] /data/db.sqlite exists but is not writable."
  echo "Owner/mode:" && ls -l /data/db.sqlite || true
  echo "Fix: chown the file on host: sudo chown $(id -u):$(id -g) data/db.sqlite*"
  exit 1
fi

echo "[entrypoint] Ensuring /data/images exists and is writable..."
mkdir -p /data/images || true
if ! touch /data/images/.writable-test 2>/dev/null; then
  echo "[entrypoint][fatal] Cannot write to /data/images"
  ls -ld /data/images || true
  exit 1
fi
rm -f /data/images/.writable-test || true

echo "[entrypoint] Checking /var/tmp/vibe-kanban permissions..."
ls -ld /var/tmp/vibe-kanban || true
if [ ! -w /var/tmp/vibe-kanban ]; then
  echo "[entrypoint][fatal] /var/tmp/vibe-kanban is not writable by current user."
  echo "Fix: chown -R $(id -u):$(id -g) ./var_tmp_vkanban on the host or run 'make fix-perms'."
  exit 1
fi

exec /usr/local/bin/vibe-kanban
