#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo
echo " BloodLink HOST for Linux"
echo " ====================="
echo " This starts a SERVER on this computer."
echo " Friends should use BloodLink-Connect.zip or the Invite People link instead."
echo

if ! command -v node >/dev/null; then
  echo "Install Node.js 22.5+ first, e.g. on Arch:"
  echo "  sudo pacman -S nodejs npm"
  exit 1
fi

echo "Using $(command -v node) $(node -v)"

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install
fi
if [[ ! -f client/dist/index.html ]]; then
  echo "Building the client..."
  npm run build
fi

export HEARTH_PORT="${HEARTH_PORT:-3928}"
export HEARTH_HOST="${HEARTH_HOST:-0.0.0.0}"
echo
echo "Starting BloodLink on http://127.0.0.1:${HEARTH_PORT}"
if command -v xdg-open >/dev/null; then
  (sleep 0.6 && xdg-open "http://127.0.0.1:${HEARTH_PORT}") >/dev/null 2>&1 &
fi
exec node server/src/index.js
