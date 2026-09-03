# Maintainer: BloodLink contributors
pkgname=hearth-git
pkgver=0.1.0
pkgrel=1
pkgdesc="BloodLink — open-source community communication for Linux and Windows"
arch=('x86_64')
url="https://github.com/IAmXMob69/BloodLink"
license=('AGPL-3.0-or-later')
depends=('nodejs')
makedepends=('npm' 'git')
provides=('hearth')
conflicts=('hearth')
source=("git+https://github.com/IAmXMob69/BloodLink.git")
sha256sums=('SKIP')

pkgver() {
  cd BloodLink
  git describe --tags --always 2>/dev/null | sed 's/^v//;s/-/./g' || echo 0.1.0
}

build() {
  cd BloodLink
  npm install
  npm run build
}

package() {
  cd BloodLink
  install -d "$pkgdir/usr/lib/bloodlink"
  cp -a server client/dist desktop assets package.json "$pkgdir/usr/lib/bloodlink/"
  # drop bulky electron downloads from a source install; users run via node
  rm -rf "$pkgdir/usr/lib/bloodlink/desktop/node_modules" || true

  install -d "$pkgdir/usr/bin"
  printf '%s\n' \
    '#!/bin/sh' \
    'export HEARTH_HOST="${HEARTH_HOST:-127.0.0.1}"' \
    'export HEARTH_CLIENT="${HEARTH_CLIENT:-/usr/lib/bloodlink/dist}"' \
    'if [ -d /usr/lib/bloodlink/client ]; then' \
    '  export HEARTH_CLIENT=/usr/lib/bloodlink/client' \
    'fi' \
    'export HEARTH_DATA="${HEARTH_DATA:-${XDG_DATA_HOME:-$HOME/.local/share}/bloodlink}"' \
    'exec node /usr/lib/bloodlink/server/src/index.js "$@"' \
    > "$pkgdir/usr/bin/bloodlink-server"
  chmod 755 "$pkgdir/usr/bin/bloodlink-server"
  ln -s bloodlink-server "$pkgdir/usr/bin/hearth-server"

  if [[ -f assets/bloodlink.desktop ]]; then
    install -Dm644 assets/bloodlink.desktop "$pkgdir/usr/share/applications/bloodlink.desktop"
  elif [[ -f assets/hearth.desktop ]]; then
    install -Dm644 assets/hearth.desktop "$pkgdir/usr/share/applications/bloodlink.desktop"
  fi
  install -Dm644 assets/icon.png "$pkgdir/usr/share/icons/hicolor/512x512/apps/bloodlink.png"
  install -Dm644 LICENSE "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
