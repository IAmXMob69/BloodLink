import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.HEARTH_DATA || join(__dirname, "..", "data");
export const UPLOAD_DIR = join(DATA_DIR, "uploads");
function dbFile() {
  const named = join(DATA_DIR, "bloodlink.db");
  const legacy = join(DATA_DIR, "hearth.db");
  if (existsSync(named) || !existsSync(legacy)) return named;
  return legacy;
}
const DB_PATH = dbFile();

mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  tag TEXT NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  avatar TEXT,
  avatar_color TEXT,
  banner_color TEXT,
  bio TEXT DEFAULT '',
  status TEXT DEFAULT 'online',
  custom_status TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE (username, tag)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  owner_id TEXT NOT NULL REFERENCES users(id),
  description TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  server_id TEXT REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  topic TEXT DEFAULT '',
  position INTEGER DEFAULT 0,
  parent_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL DEFAULT '',
  reply_to TEXT,
  attachments TEXT DEFAULT '[]',
  edited_at INTEGER,
  pinned INTEGER DEFAULT 0,
  system INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  inviter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  uses INTEGER DEFAULT 0,
  max_uses INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS dm_participants (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS reads (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_read TEXT,
  PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

for (const sql of [
  "ALTER TABLE users ADD COLUMN pubkey TEXT",
  "ALTER TABLE users ADD COLUMN privacy_json TEXT DEFAULT '{}'",
  "ALTER TABLE messages ADD COLUMN e2e INTEGER DEFAULT 0",
  "ALTER TABLE messages ADD COLUMN expires_at INTEGER",
]) {
  try {
    db.exec(sql);
  } catch {
    /* column already exists */
  }
}

export const q = {
  userById: db.prepare("SELECT * FROM users WHERE id = ?"),
  userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  userByLogin: db.prepare("SELECT * FROM users WHERE username = ? OR email = ?"),
  userByNameTag: db.prepare("SELECT * FROM users WHERE username = ? AND tag = ?"),
  insertUser: db.prepare(
    `INSERT INTO users (id, username, tag, email, password_hash, display_name, avatar_color, banner_color, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateUser: db.prepare(
    `UPDATE users SET display_name = ?, bio = ?, status = ?, custom_status = ?, avatar = ?, avatar_color = ?, banner_color = ?
     WHERE id = ?`
  ),
  updatePubkey: db.prepare("UPDATE users SET pubkey = ? WHERE id = ?"),
  updatePrivacy: db.prepare("UPDATE users SET privacy_json = ? WHERE id = ?"),
  deleteUserSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
  deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
  scrubAuthor: db.prepare("UPDATE messages SET author_id = NULL, content = '', attachments = '[]' WHERE author_id = ?"),
  userCount: db.prepare("SELECT count(*) AS n FROM users"),
  purgeExpired: db.prepare("DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < ?"),
  insertSession: db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)"),
  sessionUser: db.prepare(
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?"
  ),
  deleteSession: db.prepare("DELETE FROM sessions WHERE token = ?"),

  insertServer: db.prepare(
    "INSERT INTO servers (id, name, icon, owner_id, description, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ),
  serverById: db.prepare("SELECT * FROM servers WHERE id = ?"),
  userServers: db.prepare(
    `SELECT s.* FROM servers s JOIN members m ON m.server_id = s.id WHERE m.user_id = ? ORDER BY s.created_at`
  ),
  updateServer: db.prepare("UPDATE servers SET name = ?, icon = ?, description = ? WHERE id = ?"),
  deleteServer: db.prepare("DELETE FROM servers WHERE id = ?"),

  insertMember: db.prepare(
    "INSERT OR IGNORE INTO members (server_id, user_id, nickname, joined_at) VALUES (?, ?, ?, ?)"
  ),
  deleteMember: db.prepare("DELETE FROM members WHERE server_id = ? AND user_id = ?"),
  member: db.prepare("SELECT * FROM members WHERE server_id = ? AND user_id = ?"),
  serverMembers: db.prepare(
    `SELECT u.*, m.nickname, m.joined_at AS joined_at
     FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.server_id = ? ORDER BY u.username`
  ),

  insertChannel: db.prepare(
    "INSERT INTO channels (id, server_id, name, type, topic, position, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ),
  channelById: db.prepare("SELECT * FROM channels WHERE id = ?"),
  serverChannels: db.prepare("SELECT * FROM channels WHERE server_id = ? ORDER BY position, created_at"),
  updateChannel: db.prepare(
    "UPDATE channels SET name = ?, topic = ?, position = ?, parent_id = ? WHERE id = ?"
  ),
  deleteChannel: db.prepare("DELETE FROM channels WHERE id = ?"),
  nextPosition: db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM channels WHERE server_id = ?"),

  insertMessage: db.prepare(
    `INSERT INTO messages (id, channel_id, author_id, content, reply_to, attachments, pinned, system, created_at, e2e, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  messageById: db.prepare("SELECT * FROM messages WHERE id = ?"),
  channelMessages: db.prepare(
    `SELECT * FROM messages WHERE channel_id = ? AND (? IS NULL OR created_at < ?)
     ORDER BY created_at DESC LIMIT ?`
  ),
  updateMessage: db.prepare("UPDATE messages SET content = ?, edited_at = ? WHERE id = ?"),
  deleteMessage: db.prepare("DELETE FROM messages WHERE id = ?"),
  pinMessage: db.prepare("UPDATE messages SET pinned = ? WHERE id = ?"),
  pinnedMessages: db.prepare(
    "SELECT * FROM messages WHERE channel_id = ? AND pinned = 1 ORDER BY created_at DESC"
  ),
  searchMessages: db.prepare(
    `SELECT * FROM messages WHERE channel_id = ? AND IFNULL(e2e, 0) = 0 AND content LIKE ? ORDER BY created_at DESC LIMIT 50`
  ),

  addReaction: db.prepare(
    "INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)"
  ),
  removeReaction: db.prepare(
    "DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?"
  ),
  messageReactions: db.prepare("SELECT emoji, user_id FROM reactions WHERE message_id = ?"),
  reactionsForMessages: db.prepare(
    `SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (SELECT value FROM json_each(?))`
  ),

  insertInvite: db.prepare(
    "INSERT INTO invites (code, server_id, inviter_id, uses, max_uses, created_at) VALUES (?, ?, ?, 0, ?, ?)"
  ),
  inviteByCode: db.prepare("SELECT * FROM invites WHERE code = ?"),
  serverInvites: db.prepare("SELECT * FROM invites WHERE server_id = ? ORDER BY created_at DESC"),
  bumpInvite: db.prepare("UPDATE invites SET uses = uses + 1 WHERE code = ?"),
  deleteInvite: db.prepare("DELETE FROM invites WHERE code = ?"),

  insertFriend: db.prepare(
    "INSERT INTO friendships (id, user_a, user_b, status, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ),
  friendPair: db.prepare(
    `SELECT * FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)`
  ),
  userFriends: db.prepare(
    "SELECT * FROM friendships WHERE user_a = ? OR user_b = ?"
  ),
  updateFriend: db.prepare("UPDATE friendships SET status = ? WHERE id = ?"),
  deleteFriend: db.prepare("DELETE FROM friendships WHERE id = ?"),

  insertDmPart: db.prepare(
    "INSERT OR IGNORE INTO dm_participants (channel_id, user_id) VALUES (?, ?)"
  ),
  dmForUsers: db.prepare(
    `SELECT c.* FROM channels c
     JOIN dm_participants a ON a.channel_id = c.id AND a.user_id = ?
     JOIN dm_participants b ON b.channel_id = c.id AND b.user_id = ?
     WHERE c.type = 'dm'`
  ),
  userDms: db.prepare(
    `SELECT c.* FROM channels c
     JOIN dm_participants p ON p.channel_id = c.id
     WHERE p.user_id = ? AND c.type IN ('dm', 'group')`
  ),
  dmRecipients: db.prepare(
    `SELECT u.* FROM dm_participants p JOIN users u ON u.id = p.user_id WHERE p.channel_id = ?`
  ),

  setRead: db.prepare(
    "INSERT INTO reads (user_id, channel_id, last_read) VALUES (?, ?, ?) ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read = excluded.last_read"
  ),
  userReads: db.prepare("SELECT channel_id, last_read FROM reads WHERE user_id = ?"),
};

export function reactionsMap(messageIds) {
  const map = {};
  if (!messageIds.length) return map;
  // node:sqlite has no json_each guarantee across versions — query per-message in a pinch
  const stmt = db.prepare("SELECT emoji, user_id FROM reactions WHERE message_id = ?");
  for (const mid of messageIds) {
    const rows = stmt.all(mid);
    const by = {};
    for (const r of rows) {
      if (!by[r.emoji]) by[r.emoji] = [];
      by[r.emoji].push(r.user_id);
    }
    map[mid] = Object.entries(by).map(([emoji, users]) => ({ emoji, users, count: users.length }));
  }
  return map;
}
