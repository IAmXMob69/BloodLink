#!/usr/bin/env bash
# Build BloodLink-for-everyone-VERSION.zip for handing to friends.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(node -p "require('$ROOT/package.json').version" 2>/dev/null || echo 0.1.0)"
NAME="BloodLink-for-everyone-${VER}"
OUT="$ROOT/share"
STAGE="$OUT/$NAME"
ZIP="$OUT/${NAME}.zip"

cd "$ROOT"
if [[ ! -f client/dist/index.html ]]; then
  npm run build
fi

rm -rf "$STAGE"
mkdir -p "$STAGE"

# Copy the project without junk
tar -C "$ROOT" -cf - \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=share \
  --exclude=server/data \
  --exclude=desktop/release \
  --exclude=client/dist \
  --exclude=android/.gradle \
  --exclude=android/build \
  --exclude=android/app/build \
  --exclude=android/.idea \
  --exclude=android/local.properties \
  START-HERE.txt LICENSE README.md CONTRIBUTING.md SECURITY.md PKGBUILD \
  package.json package-lock.json .gitignore \
  install-linux.sh install-windows.bat install-windows.ps1 \
  assets client server desktop scripts android \
  | tar -C "$STAGE" -xf -

# Include the already-built web client so hosts can skip a long first build
mkdir -p "$STAGE/client/dist"
cp -a "$ROOT/client/dist/." "$STAGE/client/dist/"

chmod +x "$STAGE/install-linux.sh" "$STAGE/scripts/"*.sh || true

rm -f "$ZIP"
(
  cd "$OUT"
  zip -qr "$ZIP" "$NAME"
)

# Easy-to-find copies
cp -f "$ZIP" "$HOME/Desktop/${NAME}.zip" 2>/dev/null || true
cp -f "$ROOT/START-HERE.txt" "$HOME/Desktop/BloodLink-START-HERE.txt" 2>/dev/null || true

echo
echo "Share this file:"
echo "  $ZIP"
ls -lh "$ZIP"
echo
echo "Also copied to your Desktop if that folder exists."
