#!/usr/bin/env bash
# Start Hearth as a desktop window on Linux (Xfce, etc.).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export DISPLAY="${DISPLAY:-:0}"
export HEARTH_PORT="${HEARTH_PORT:-3928}"

if [[ ! -d node_modules ]]; then
  npm install
fi

if ! curl -sf "http://127.0.0.1:${HEARTH_PORT}/api/health" >/dev/null; then
  if [[ ! -d client/dist ]]; then
    npm run build
  fi
  node server/src/index.js >/tmp/hearth-server.log 2>&1 &
  for _ in $(seq 1 40); do
    curl -sf "http://127.0.0.1:${HEARTH_PORT}/api/health" >/dev/null && break
    sleep 0.2
  done
fi

ELECTRON_BIN="${ELECTRON_PATH:-}"
if [[ -z "$ELECTRON_BIN" ]]; then
  for c in /usr/lib/electron42/electron /usr/lib/electron/electron /usr/bin/electron \
           "$ROOT/node_modules/electron/dist/electron"; do
    if [[ -x "$c" ]]; then ELECTRON_BIN="$c"; break; fi
  done
fi

if [[ -n "$ELECTRON_BIN" ]]; then
  exec "$ELECTRON_BIN" "$ROOT/desktop"
fi

# No Electron — open in the default browser
if command -v xdg-open >/dev/null; then
  exec xdg-open "http://127.0.0.1:${HEARTH_PORT}"
fi
echo "Open http://127.0.0.1:${HEARTH_PORT} in your browser."
