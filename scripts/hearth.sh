#!/usr/bin/env bash
# Launch Hearth on this machine (Arch / any Linux).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -d node_modules ]]; then
  echo "Installing dependencies…"
  npm install
fi
if [[ ! -d client/dist ]]; then
  echo "Building client…"
  npm run build
fi
export HEARTH_PORT="${HEARTH_PORT:-3928}"
echo "Hearth → http://127.0.0.1:${HEARTH_PORT}"
exec npm run server
