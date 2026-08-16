# Maintainer: Hearth contributors
pkgname=hearth-git
pkgver=0.1.0
pkgrel=1
pkgdesc="Open-source community communication for Linux and Windows"
arch=('x86_64')
url="https://github.com/IAmXMob69/hearth"
license=('AGPL-3.0-or-later')
depends=('nodejs')
makedepends=('npm' 'git')
provides=('hearth')
conflicts=('hearth')
source=("git+https://github.com/IAmXMob69/hearth.git")
sha256sums=('SKIP')

pkgver() {
  cd hearth
  git describe --tags --always 2>/dev/null | sed 's/^v//;s/-/./g' || echo 0.1.0
}

build() {
  cd hearth
  npm install
  npm run build
}

package() {
  cd hearth
  install -d "$pkgdir/usr/lib/hearth"
  cp -a server client/dist desktop assets package.json "$pkgdir/usr/lib/hearth/"
  # drop bulky electron downloads from a source install; users run via node
  rm -rf "$pkgdir/usr/lib/hearth/desktop/node_modules" || true

  install -Dm755 /dev/stdin "$pkgdir/usr/bin/hearth-server" <<'EOF'
#!/bin/sh
export HEARTH_CLIENT="${HEARTH_CLIENT:-/usr/lib/hearth/dist}"
if [ -d /usr/lib/hearth/client ]; then
  export HEARTH_CLIENT=/usr/lib/hearth/client
fi
export HEARTH_DATA="${HEARTH_DATA:-${XDG_DATA_HOME:-$HOME/.local/share}/hearth}"
exec node /usr/lib/hearth/server/src/index.js "$@"
EOF

  install -Dm644 assets/hearth.desktop "$pkgdir/usr/share/applications/hearth.desktop"
  install -Dm644 assets/icon.png "$pkgdir/usr/share/icons/hicolor/512x512/apps/hearth.png"
  install -Dm644 LICENSE "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
