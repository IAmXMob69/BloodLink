#!/usr/bin/env bash
# Build BloodLink-Host.zip — full server pack so someone else can host.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$ROOT/share/BloodLink-Host}"
STAGE="$DEST"
ZIP="$(dirname "$STAGE")/BloodLink-Host.zip"

cd "$ROOT"
if [[ ! -f client/dist/index.html ]]; then
  npm run build
fi

rm -rf "$STAGE"
mkdir -p "$STAGE"

tar -C "$ROOT" -cf - \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=share \
  --exclude=server/data \
  --exclude=desktop/release \
  --exclude=android/.gradle \
  --exclude=android/build \
  --exclude=android/app/build \
  --exclude=android/.idea \
  --exclude=android/local.properties \
  HOST-START-HERE.txt START-HERE.txt LICENSE README.md HOW-IT-WORKS.md PRIVACY.md \
  CONTRIBUTING.md SECURITY.md PKGBUILD \
  package.json package-lock.json .gitignore \
  install-linux.sh install-windows.bat install-windows.ps1 \
  assets client server desktop scripts android \
  | tar -C "$STAGE" -xf -

# Do not ship someone else's built client only — include dist so first start is faster
if [[ -d "$ROOT/client/dist" ]]; then
  mkdir -p "$STAGE/client/dist"
  cp -a "$ROOT/client/dist/." "$STAGE/client/dist/"
fi

# Make the host readme the first thing they see
cp -f "$ROOT/HOST-START-HERE.txt" "$STAGE/READ-ME-FIRST.txt"

chmod +x "$STAGE/install-linux.sh" "$STAGE/scripts/"*.sh 2>/dev/null || true

rm -f "$ZIP"
(
  cd "$(dirname "$STAGE")"
  zip -qr "$ZIP" "$(basename "$STAGE")"
)

echo "$ZIP"
