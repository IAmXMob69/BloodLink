#!/usr/bin/env bash
# Expose local BloodLink to the public internet (HTTPS).
# Writes the live URL to $HEARTH_DATA/public-url
set -euo pipefail
DATA="${HEARTH_DATA:-$HOME/.local/share/bloodlink}"
URLF="$DATA/public-url"
LOG="$DATA/tunnel.log"
mkdir -p "$DATA"
: >"$LOG"

write_url() {
  local u="${1%/}"
  [[ -z "$u" ]] && return
  echo "$u" >"$URLF"
  echo "public url: $u" | tee -a "$LOG"
}

watch_line() {
  # read stdout/stderr lines, pick the first https URL
  while IFS= read -r line; do
    echo "$line" >>"$LOG"
    if [[ "$line" =~ https://[a-zA-Z0-9-]+\.trycloudflare\.com ]]; then
      write_url "${BASH_REMATCH[0]}"
    elif [[ "$line" =~ https://[a-zA-Z0-9.-]+\.(localhost\.run|lhr\.life|serveo\.net) ]]; then
      write_url "${BASH_REMATCH[0]}"
    fi
  done
}

ensure_cloudflared() {
  local dest="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
  if [[ -x "$dest" ]]; then echo "$dest"; return; fi
  if command -v cloudflared >/dev/null; then command -v cloudflared; return; fi
  mkdir -p "$(dirname "$dest")"
  echo "downloading cloudflared…" >>"$LOG"
  if curl -fL --retry 4 --retry-delay 2 --max-time 180 \
      -o "$dest.new" \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"; then
    chmod +x "$dest.new"
    mv "$dest.new" "$dest"
    echo "$dest"
  fi
}

CF="$(ensure_cloudflared || true)"
if [[ -n "${CF:-}" && -x "$CF" ]]; then
  echo "using $CF" | tee -a "$LOG"
  "$CF" tunnel --no-autoupdate --url "http://127.0.0.1:${HEARTH_PORT:-3928}" 2>&1 | watch_line
  exit "${PIPESTATUS[0]}"
fi

echo "cloudflared missing — trying SSH tunnels" | tee -a "$LOG"
echo "trying localhost.run" | tee -a "$LOG"
ssh -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -o StrictHostKeyChecking=accept-new \
    -R 80:127.0.0.1:"${HEARTH_PORT:-3928}" \
    nokey@localhost.run 2>&1 | watch_line
echo "trying serveo.net" | tee -a "$LOG"
ssh -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
    -o StrictHostKeyChecking=accept-new \
    -R 80:127.0.0.1:"${HEARTH_PORT:-3928}" \
    serveo.net 2>&1 | watch_line
