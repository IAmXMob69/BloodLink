import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, UPLOAD_DIR } from "./db.js";
import { clampText, id, now } from "./util.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SEED_DIR = join(__dirname, "..", "seed-stickers");

db.exec(`
CREATE TABLE IF NOT EXISTS sticker_packs (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  cover_url TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  builtin INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stickers (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
  emoji TEXT DEFAULT '✨',
  url TEXT NOT NULL,
  filename TEXT,
  mime TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sticker_packs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, pack_id)
);

CREATE TABLE IF NOT EXISTS sticker_recent (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sticker_id TEXT NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
  used_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, sticker_id)
);

CREATE INDEX IF NOT EXISTS idx_stickers_pack ON stickers(pack_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_sticker_recent_user ON sticker_recent(user_id, used_at);
`);

export const sq = {
  insertPack: db.prepare(
    `INSERT INTO sticker_packs (id, slug, name, description, cover_url, created_by, builtin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updatePack: db.prepare(
    "UPDATE sticker_packs SET name = ?, description = ?, cover_url = ? WHERE id = ?"
  ),
  deletePack: db.prepare("DELETE FROM sticker_packs WHERE id = ?"),
  packById: db.prepare("SELECT * FROM sticker_packs WHERE id = ?"),
  packBySlug: db.prepare("SELECT * FROM sticker_packs WHERE slug = ?"),
  allPacks: db.prepare("SELECT * FROM sticker_packs ORDER BY builtin DESC, created_at"),
  builtinPacks: db.prepare("SELECT * FROM sticker_packs WHERE builtin = 1 ORDER BY created_at"),
  packsByOwner: db.prepare("SELECT * FROM sticker_packs WHERE created_by = ? ORDER BY created_at DESC"),

  insertSticker: db.prepare(
    `INSERT INTO stickers (id, pack_id, emoji, url, filename, mime, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  deleteSticker: db.prepare("DELETE FROM stickers WHERE id = ?"),
  stickerById: db.prepare("SELECT * FROM stickers WHERE id = ?"),
  stickersInPack: db.prepare("SELECT * FROM stickers WHERE pack_id = ? ORDER BY sort_order, created_at"),
  stickerByUrl: db.prepare("SELECT * FROM stickers WHERE pack_id = ? AND url = ?"),
  stickerCount: db.prepare("SELECT count(*) AS n FROM stickers WHERE pack_id = ?"),
  nextSort: db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM stickers WHERE pack_id = ?"),

  installPack: db.prepare(
    "INSERT OR IGNORE INTO user_sticker_packs (user_id, pack_id, position) VALUES (?, ?, ?)"
  ),
  uninstallPack: db.prepare("DELETE FROM user_sticker_packs WHERE user_id = ? AND pack_id = ?"),
  installedPacks: db.prepare(
    `SELECT p.*, u.position FROM sticker_packs p
     JOIN user_sticker_packs u ON u.pack_id = p.id
     WHERE u.user_id = ? ORDER BY u.position, p.created_at`
  ),
  installedRow: db.prepare("SELECT * FROM user_sticker_packs WHERE user_id = ? AND pack_id = ?"),
  userPackCount: db.prepare("SELECT count(*) AS n FROM user_sticker_packs WHERE user_id = ?"),
  nextInstallPos: db.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS n FROM user_sticker_packs WHERE user_id = ?"
  ),

  touchRecent: db.prepare(
    `INSERT INTO sticker_recent (user_id, sticker_id, used_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id, sticker_id) DO UPDATE SET used_at = excluded.used_at`
  ),
  recentStickers: db.prepare(
    `SELECT s.* FROM sticker_recent r
     JOIN stickers s ON s.id = r.sticker_id
     WHERE r.user_id = ?
     ORDER BY r.used_at DESC LIMIT 30`
  ),
  pruneRecent: db.prepare(
    `DELETE FROM sticker_recent WHERE user_id = ? AND sticker_id NOT IN (
       SELECT sticker_id FROM sticker_recent WHERE user_id = ? ORDER BY used_at DESC LIMIT 30
     )`
  ),
};

const MIME = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export function serializeSticker(row) {
  if (!row) return null;
  return {
    id: row.id,
    pack_id: row.pack_id,
    emoji: row.emoji || "✨",
    url: row.url,
    filename: row.filename,
    mime: row.mime || "image/png",
  };
}

export function serializePack(row, { stickers, installed } = {}) {
  if (!row) return null;
  const count = stickers ? stickers.length : sq.stickerCount.get(row.id).n;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description || "",
    cover_url: row.cover_url,
    created_by: row.created_by,
    builtin: Boolean(row.builtin),
    created_at: row.created_at,
    count,
    installed: Boolean(installed),
    stickers: stickers ? stickers.map(serializeSticker) : undefined,
  };
}

export function seedBuiltinPacks() {
  if (!existsSync(SEED_DIR)) return;
  mkdirSync(UPLOAD_DIR, { recursive: true });
  for (const dir of readdirSync(SEED_DIR)) {
    const packDir = join(SEED_DIR, dir);
    let st;
    try {
      st = statSync(packDir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const metaPath = join(packDir, "pack.json");
    if (!existsSync(metaPath)) continue;
    let meta;
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8"));
    } catch {
      continue;
    }
    const slug = clampText(meta.slug || dir, 40).replace(/[^\w-]+/g, "-").toLowerCase();
    if (!slug) continue;
    let pack = sq.packBySlug.get(slug);
    if (!pack) {
      const pid = `pack_${slug}`;
      sq.insertPack.run(
        pid,
        slug,
        clampText(meta.name || slug, 40),
        clampText(meta.description || "", 200),
        null,
        null,
        1,
        now()
      );
      pack = sq.packById.get(pid);
    }
    const items = Array.isArray(meta.stickers) ? meta.stickers : [];
    for (const [i, item] of items.entries()) {
      const file = String(item.file || "");
      if (!file || file.includes("..") || file.includes("/") || file.includes("\\")) continue;
      const src = join(packDir, file);
      if (!existsSync(src)) continue;
      const destName = `stk-${slug}-${file.replace(/[^\w.\-]+/g, "_")}`;
      const dest = join(UPLOAD_DIR, destName);
      if (!existsSync(dest) || statSync(src).mtimeMs > statSync(dest).mtimeMs) {
        copyFileSync(src, dest);
      }
      const url = `/uploads/${destName}`;
      if (sq.stickerByUrl.get(pack.id, url)) continue;
      const ext = extname(file).toLowerCase();
      const sid = `stk_${slug}_${file.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_")}`;
      try {
        sq.insertSticker.run(
          sid,
          pack.id,
          clampText(item.emoji || "✨", 16),
          url,
          file,
          MIME[ext] || "image/png",
          i,
          now()
        );
      } catch {
        sq.insertSticker.run(
          id(),
          pack.id,
          clampText(item.emoji || "✨", 16),
          url,
          file,
          MIME[ext] || "image/png",
          i,
          now()
        );
      }
    }
    if (!pack.cover_url) {
      const first = sq.stickersInPack.all(pack.id)[0];
      const coverName = meta.cover ? `stk-${slug}-${String(meta.cover).replace(/[^\w.\-]+/g, "_")}` : first?.url;
      const cover = first ? first.url : coverName && coverName.startsWith("/uploads/") ? coverName : coverName ? `/uploads/${coverName}` : null;
      if (cover) sq.updatePack.run(pack.name, pack.description, cover, pack.id);
    }
  }
}

export function ensureInstalled(userId) {
  if (!userId) return;
  if (sq.userPackCount.get(userId).n > 0) return;
  let pos = 0;
  for (const p of sq.builtinPacks.all()) {
    sq.installPack.run(userId, p.id, pos++);
  }
}

export function isHostUser(userId) {
  const row = db.prepare("SELECT 1 AS n FROM servers WHERE owner_id = ? LIMIT 1").get(userId);
  return Boolean(row);
}

export function canEditPack(pack, userId) {
  if (!pack) return false;
  if (pack.created_by && pack.created_by === userId) return true;
  if (isHostUser(userId)) return true;
  return false;
}

export function stickerAttachment(st) {
  return {
    url: st.url,
    filename: st.filename || "sticker.png",
    size: 0,
    mime: st.mime || "image/png",
    kind: "sticker",
    sticker_id: st.id,
    emoji: st.emoji || "✨",
    pack_id: st.pack_id,
  };
}

export function markRecent(userId, stickerId) {
  sq.touchRecent.run(userId, stickerId, now());
  const keep = db.prepare(
    "SELECT sticker_id FROM sticker_recent WHERE user_id = ? ORDER BY used_at DESC LIMIT 30"
  ).all(userId);
  if (keep.length < 30) return;
  const oldest = db.prepare(
    "SELECT used_at FROM sticker_recent WHERE user_id = ? ORDER BY used_at DESC LIMIT 1 OFFSET 29"
  ).get(userId);
  if (oldest) {
    db.prepare("DELETE FROM sticker_recent WHERE user_id = ? AND used_at < ?").run(userId, oldest.used_at);
  }
}

export function slugify(name) {
  const base = clampText(name, 40)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "pack";
  if (!sq.packBySlug.get(base)) return base;
  for (let i = 0; i < 20; i++) {
    const s = `${base}-${id().slice(0, 4)}`;
    if (!sq.packBySlug.get(s)) return s;
  }
  return `${base}-${id().slice(0, 8)}`;
}
