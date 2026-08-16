import http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { extname, join, dirname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { db, q, DATA_DIR, UPLOAD_DIR, reactionsMap } from "./db.js";
import {
  id,
  token,
  tag,
  inviteCode,
  hashPassword,
  verifyPassword,
  now,
  publicUser,
  colorFor,
  validUsername,
  validPassword,
  clampText,
} from "./util.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HEARTH_PORT || 3928);
const HOST = process.env.HEARTH_HOST || "0.0.0.0";
const SOURCE_URL = process.env.HEARTH_SOURCE || "https://github.com/IAmXMob69/hearth";

const CLIENT_CANDIDATES = [
  process.env.HEARTH_CLIENT,
  join(__dirname, "..", "..", "client", "dist"),
  join(__dirname, "..", "..", "..", "client"),
].filter(Boolean);

function clientDir() {
  return CLIENT_CANDIDATES.find((p) => p && existsSync(join(p, "index.html"))) || null;
}

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

const sockets = new Map(); // ws -> { userId }
const online = new Map(); // userId -> Set<ws>
const voice = new Map(); // userId -> { channel_id, muted, deafened, streaming }

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function emitUser(userId, payload) {
  const set = online.get(userId);
  if (!set) return;
  for (const ws of set) send(ws, payload);
}

function userServers(userId) {
  return q.userServers.all(userId);
}

function emitServer(serverId, payload, except) {
  const members = q.serverMembers.all(serverId);
  for (const m of members) {
    if (except && m.id === except) continue;
    emitUser(m.id, payload);
  }
}

function emitChannel(channelId, payload, except) {
  const ch = q.channelById.get(channelId);
  if (!ch) return;
  if (ch.server_id) return emitServer(ch.server_id, payload, except);
  const recips = q.dmRecipients.all(channelId);
  for (const u of recips) {
    if (except && u.id === except) continue;
    emitUser(u.id, payload);
  }
}

function isOnline(userId) {
  return online.has(userId);
}

function presenceOf(user) {
  if (!user) return "offline";
  if (!isOnline(user.id)) return "offline";
  if (user.status === "invisible") return "offline";
  return user.status || "online";
}

function decorateUser(user) {
  const pub = publicUser(user);
  if (!pub) return null;
  pub.status = presenceOf(user);
  const vs = voice.get(user.id);
  if (vs) pub.voice = vs;
  return pub;
}

function serializeMessage(row, reactions) {
  const author = row.author_id ? q.userById.get(row.author_id) : null;
  let attachments = [];
  try {
    attachments = JSON.parse(row.attachments || "[]");
  } catch {
    attachments = [];
  }
  return {
    id: row.id,
    channel_id: row.channel_id,
    author: decorateUser(author),
    content: row.content,
    reply_to: row.reply_to,
    attachments,
    edited_at: row.edited_at,
    pinned: Boolean(row.pinned),
    system: Boolean(row.system),
    created_at: row.created_at,
    reactions: reactions || [],
  };
}

function canSeeChannel(userId, channel) {
  if (!channel) return false;
  if (channel.server_id) return Boolean(q.member.get(channel.server_id, userId));
  const recips = q.dmRecipients.all(channel.id);
  return recips.some((u) => u.id === userId);
}

function isOwner(server, userId) {
  return server && server.owner_id === userId;
}

function hydrateServer(server, meId) {
  const channels = q.serverChannels.all(server.id);
  const members = q.serverMembers.all(server.id).map((u) => {
    const dec = decorateUser(u);
    dec.nickname = u.nickname;
    dec.joined_at = u.joined_at;
    return dec;
  });
  return {
    id: server.id,
    name: server.name,
    icon: server.icon,
    owner_id: server.owner_id,
    description: server.description,
    created_at: server.created_at,
    channels,
    members,
    is_owner: server.owner_id === meId,
  };
}

function hydrateDm(channel, meId) {
  const recips = q.dmRecipients.all(channel.id).map((u) => decorateUser(u));
  return {
    ...channel,
    recipients: recips.filter((u) => u && u.id !== meId),
    all_recipients: recips,
  };
}

function readyPayload(user) {
  const servers = userServers(user.id).map((s) => hydrateServer(s, user.id));
  const dms = q.userDms.all(user.id).map((c) => hydrateDm(c, user.id));
  const friendRows = q.userFriends.all(user.id, user.id);
  const friends = [];
  const pending = [];
  for (const f of friendRows) {
    const otherId = f.user_a === user.id ? f.user_b : f.user_a;
    const other = decorateUser(q.userById.get(otherId));
    const item = { id: f.id, user: other, status: f.status, requested_by: f.requested_by };
    if (f.status === "accepted") friends.push(item);
    else pending.push(item);
  }
  const reads = {};
  for (const r of q.userReads.all(user.id)) reads[r.channel_id] = r.last_read;
  return {
    type: "ready",
    user: publicUser(user, { includeEmail: true }),
    servers,
    dms,
    friends,
    pending,
    reads,
    voice_states: [...voice.entries()].map(([uid, st]) => ({ user_id: uid, ...st })),
    source_url: SOURCE_URL,
  };
}

function createDefaultServer(user) {
  const sid = id();
  const t = now();
  q.insertServer.run(sid, `${user.display_name || user.username}'s server`, null, user.id, "Welcome to Hearth.", t);
  q.insertMember.run(sid, user.id, null, t);
  const cat = id();
  q.insertChannel.run(cat, sid, "Text channels", "category", "", 0, null, t);
  q.insertChannel.run(id(), sid, "general", "text", "Say hello.", 1, cat, t);
  q.insertChannel.run(id(), sid, "off-topic", "text", "", 2, cat, t);
  const vcat = id();
  q.insertChannel.run(vcat, sid, "Voice channels", "category", "", 3, null, t);
  q.insertChannel.run(id(), sid, "Lobby", "voice", "", 4, vcat, t);
  q.insertChannel.run(id(), sid, "Hangout", "voice", "", 5, vcat, t);
  const code = inviteCode();
  q.insertInvite.run(code, sid, user.id, 0, t);
  const general = q.serverChannels.all(sid).find((c) => c.name === "general" && c.type === "text");
  if (general) {
    q.insertMessage.run(
      id(),
      general.id,
      null,
      `Welcome to **${user.display_name || user.username}'s server**. This is Hearth — invite friends with the code \`${code}\`.`,
      null,
      "[]",
      0,
      1,
      t
    );
  }
  return { server: q.serverById.get(sid), invite: code };
}

function pairKey(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function readBody(req, limit = 16 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      req.destroy();
      throw Object.assign(new Error("payload too large"), { status: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function cors(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Filename, X-Kind");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
}

function auth(req) {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!tok) return null;
  return q.sessionUser.get(tok) || null;
}

const routes = [];
function route(method, pattern, handler, { authRequired = true } = {}) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:([A-Za-z_]+)/g, (_, k) => {
    keys.push(k);
    return "([^/]+)";
  }) + "$");
  routes.push({ method, re, keys, handler, authRequired });
}

route("GET", "/api/health", async (_req, res) => {
  json(res, 200, { ok: true, name: "hearth", version: "0.1.0", source: SOURCE_URL });
}, { authRequired: false });

route("GET", "/api/source", async (_req, res) => {
  json(res, 200, { source: SOURCE_URL, license: "AGPL-3.0-or-later" });
}, { authRequired: false });

route("POST", "/api/register", async (req, res, _p, body) => {
  const username = clampText(body.username || "", 32).trim();
  const password = body.password || "";
  const email = clampText(body.email || "", 120).trim().toLowerCase() || null;
  const display = clampText(body.display_name || username, 32);
  if (!validUsername(username)) {
    return json(res, 400, { error: "Username must be 2–32 letters, numbers, or underscores." });
  }
  if (!validPassword(password)) {
    return json(res, 400, { error: "Password must be at least 8 characters." });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(res, 400, { error: "Invalid email." });
  }
  if (email && q.userByEmail.get(email)) {
    return json(res, 409, { error: "Email already in use." });
  }
  let t = tag();
  for (let i = 0; i < 20 && q.userByNameTag.get(username, t); i++) t = tag();
  if (q.userByNameTag.get(username, t)) {
    return json(res, 409, { error: "Could not allocate a tag. Try another username." });
  }
  const uid = id();
  const hash = await hashPassword(password);
  const tnow = now();
  q.insertUser.run(uid, username, t, email, hash, display, colorFor(username), colorFor(username + t), tnow);
  const tok = token();
  q.insertSession.run(tok, uid, tnow);
  const user = q.userById.get(uid);
  const first = q.userServers.all(uid).length === 0;
  let invite = null;
  if (first) {
    const created = createDefaultServer(user);
    invite = created.invite;
  }
  json(res, 201, { token: tok, user: publicUser(user, { includeEmail: true }), invite });
}, { authRequired: false });

route("POST", "/api/login", async (req, res, _p, body) => {
  const login = clampText(body.username || body.email || "", 120).trim();
  const password = body.password || "";
  if (!login || !password) return json(res, 400, { error: "Username and password required." });
  let user = null;
  if (login.includes("#")) {
    const [name, tg] = login.split("#");
    user = q.userByNameTag.get(name, tg);
  } else {
    user = q.userByLogin.get(login, login.toLowerCase());
  }
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json(res, 401, { error: "Invalid username or password." });
  }
  const tok = token();
  q.insertSession.run(tok, user.id, now());
  json(res, 200, { token: tok, user: publicUser(user, { includeEmail: true }) });
}, { authRequired: false });

route("POST", "/api/logout", async (req, res) => {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (tok) q.deleteSession.run(tok);
  json(res, 200, { ok: true });
});

route("GET", "/api/me", async (req, res, _p, _b, user) => {
  json(res, 200, { user: publicUser(user, { includeEmail: true }) });
});

route("PATCH", "/api/me", async (req, res, _p, body, user) => {
  const display = body.display_name !== undefined ? clampText(body.display_name, 32) : user.display_name;
  const bio = body.bio !== undefined ? clampText(body.bio, 190) : user.bio;
  const status = ["online", "idle", "dnd", "invisible"].includes(body.status) ? body.status : user.status;
  const custom = body.custom_status !== undefined ? clampText(body.custom_status, 128) : user.custom_status;
  const avatar = body.avatar !== undefined ? body.avatar : user.avatar;
  const avatar_color = body.avatar_color || user.avatar_color;
  const banner_color = body.banner_color || user.banner_color;
  q.updateUser.run(display, bio, status, custom, avatar, avatar_color, banner_color, user.id);
  const next = q.userById.get(user.id);
  for (const s of userServers(user.id)) {
    emitServer(s.id, { type: "presence", user: decorateUser(next) });
  }
  emitUser(user.id, { type: "user.update", user: publicUser(next, { includeEmail: true }) });
  json(res, 200, { user: publicUser(next, { includeEmail: true }) });
});

route("GET", "/api/bootstrap", async (req, res, _p, _b, user) => {
  json(res, 200, readyPayload(user));
});

route("POST", "/api/servers", async (req, res, _p, body, user) => {
  const name = clampText(body.name || "", 100).trim();
  if (name.length < 2) return json(res, 400, { error: "Server name is too short." });
  const sid = id();
  const t = now();
  q.insertServer.run(sid, name, body.icon || null, user.id, clampText(body.description || "", 300), t);
  q.insertMember.run(sid, user.id, null, t);
  const cat = id();
  q.insertChannel.run(cat, sid, "Text channels", "category", "", 0, null, t);
  q.insertChannel.run(id(), sid, "general", "text", "", 1, cat, t);
  const vcat = id();
  q.insertChannel.run(vcat, sid, "Voice channels", "category", "", 2, null, t);
  q.insertChannel.run(id(), sid, "General", "voice", "", 3, vcat, t);
  const code = inviteCode();
  q.insertInvite.run(code, sid, user.id, 0, t);
  const server = hydrateServer(q.serverById.get(sid), user.id);
  emitUser(user.id, { type: "server.create", server });
  json(res, 201, { server, invite: code });
});

route("PATCH", "/api/servers/:id", async (req, res, p, body, user) => {
  const server = q.serverById.get(p.id);
  if (!server) return json(res, 404, { error: "Server not found." });
  if (!isOwner(server, user.id)) return json(res, 403, { error: "Only the owner can edit this server." });
  q.updateServer.run(
    clampText(body.name || server.name, 100),
    body.icon !== undefined ? body.icon : server.icon,
    body.description !== undefined ? clampText(body.description, 300) : server.description,
    server.id
  );
  const next = hydrateServer(q.serverById.get(server.id), user.id);
  emitServer(server.id, { type: "server.update", server: next });
  json(res, 200, { server: next });
});

route("DELETE", "/api/servers/:id", async (req, res, p, _b, user) => {
  const server = q.serverById.get(p.id);
  if (!server) return json(res, 404, { error: "Server not found." });
  if (!isOwner(server, user.id)) return json(res, 403, { error: "Only the owner can delete this server." });
  emitServer(server.id, { type: "server.delete", server_id: server.id });
  q.deleteServer.run(server.id);
  json(res, 200, { ok: true });
});

route("POST", "/api/servers/:id/leave", async (req, res, p, _b, user) => {
  const server = q.serverById.get(p.id);
  if (!server) return json(res, 404, { error: "Server not found." });
  if (isOwner(server, user.id)) return json(res, 400, { error: "Owner cannot leave. Transfer or delete the server." });
  q.deleteMember.run(server.id, user.id);
  emitServer(server.id, { type: "member.remove", server_id: server.id, user_id: user.id });
  emitUser(user.id, { type: "server.delete", server_id: server.id });
  json(res, 200, { ok: true });
});

route("POST", "/api/servers/:id/channels", async (req, res, p, body, user) => {
  const server = q.serverById.get(p.id);
  if (!server) return json(res, 404, { error: "Server not found." });
  if (!isOwner(server, user.id)) return json(res, 403, { error: "Only the owner can create channels." });
  const name = clampText(body.name || "", 80).trim().replace(/\s+/g, "-").toLowerCase();
  const type = ["text", "voice", "category"].includes(body.type) ? body.type : "text";
  if (name.length < 1) return json(res, 400, { error: "Channel name required." });
  const pos = q.nextPosition.get(server.id).n;
  const cid = id();
  q.insertChannel.run(cid, server.id, type === "category" ? clampText(body.name, 80) : name, type, clampText(body.topic || "", 200), pos, body.parent_id || null, now());
  const channel = q.channelById.get(cid);
  emitServer(server.id, { type: "channel.create", channel });
  json(res, 201, { channel });
});

route("PATCH", "/api/channels/:id", async (req, res, p, body, user) => {
  const channel = q.channelById.get(p.id);
  if (!channel || !channel.server_id) return json(res, 404, { error: "Channel not found." });
  const server = q.serverById.get(channel.server_id);
  if (!isOwner(server, user.id)) return json(res, 403, { error: "Only the owner can edit channels." });
  const name = body.name !== undefined ? clampText(body.name, 80) : channel.name;
  q.updateChannel.run(name, body.topic !== undefined ? clampText(body.topic, 200) : channel.topic, body.position ?? channel.position, body.parent_id === undefined ? channel.parent_id : body.parent_id, channel.id);
  const next = q.channelById.get(channel.id);
  emitServer(server.id, { type: "channel.update", channel: next });
  json(res, 200, { channel: next });
});

route("DELETE", "/api/channels/:id", async (req, res, p, _b, user) => {
  const channel = q.channelById.get(p.id);
  if (!channel || !channel.server_id) return json(res, 404, { error: "Channel not found." });
  const server = q.serverById.get(channel.server_id);
  if (!isOwner(server, user.id)) return json(res, 403, { error: "Only the owner can delete channels." });
  q.deleteChannel.run(channel.id);
  emitServer(server.id, { type: "channel.delete", channel_id: channel.id, server_id: server.id });
  json(res, 200, { ok: true });
});

route("GET", "/api/channels/:id/messages", async (req, res, p, _b, user) => {
  const channel = q.channelById.get(p.id);
  if (!channel || !canSeeChannel(user.id, channel)) return json(res, 404, { error: "Channel not found." });
  const url = new URL(req.url, "http://local");
  const before = url.searchParams.get("before");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const beforeRow = before ? q.messageById.get(before) : null;
  const beforeTs = beforeRow ? beforeRow.created_at : null;
  const rows = q.channelMessages.all(channel.id, beforeTs, beforeTs, limit).reverse();
  const rx = reactionsMap(rows.map((r) => r.id));
  json(res, 200, { messages: rows.map((r) => serializeMessage(r, rx[r.id] || [])) });
});

route("GET", "/api/channels/:id/pins", async (req, res, p, _b, user) => {
  const channel = q.channelById.get(p.id);
  if (!channel || !canSeeChannel(user.id, channel)) return json(res, 404, { error: "Channel not found." });
  const rows = q.pinnedMessages.all(channel.id);
  const rx = reactionsMap(rows.map((r) => r.id));
  json(res, 200, { messages: rows.map((r) => serializeMessage(r, rx[r.id] || [])) });
});

route("GET", "/api/channels/:id/search", async (req, res, p, _b, user) => {
  const channel = q.channelById.get(p.id);
  if (!channel || !canSeeChannel(user.id, channel)) return json(res, 404, { error: "Channel not found." });
  const url = new URL(req.url, "http://local");
  const query = clampText(url.searchParams.get("q") || "", 80);
  if (query.length < 2) return json(res, 200, { messages: [] });
  const rows = q.searchMessages.all(channel.id, `%${query}%`);
  const rx = reactionsMap(rows.map((r) => r.id));
  json(res, 200, { messages: rows.map((r) => serializeMessage(r, rx[r.id] || [])) });
});

route("POST", "/api/channels/:id/messages", async (req, res, p, body, user) => {
  const channel = q.channelById.get(p.id);
  if (!channel || !canSeeChannel(user.id, channel)) return json(res, 404, { error: "Channel not found." });
  if (channel.type === "voice" || channel.type === "category") {
    return json(res, 400, { error: "Cannot send messages here." });
  }
  const content = clampText(body.content || "", 4000);
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 8) : [];
  if (!content.trim() && !attachments.length) return json(res, 400, { error: "Message is empty." });
  const mid = id();
  q.insertMessage.run(mid, channel.id, user.id, content, body.reply_to || null, JSON.stringify(attachments), 0, 0, now());
  const msg = serializeMessage(q.messageById.get(mid), []);
  emitChannel(channel.id, { type: "message.create", message: msg });
  json(res, 201, { message: msg });
});

route("PATCH", "/api/messages/:id", async (req, res, p, body, user) => {
  const row = q.messageById.get(p.id);
  if (!row) return json(res, 404, { error: "Message not found." });
  if (row.author_id !== user.id) return json(res, 403, { error: "You can only edit your own messages." });
  const content = clampText(body.content || "", 4000);
  q.updateMessage.run(content, now(), row.id);
  const next = serializeMessage(q.messageById.get(row.id), reactionsMap([row.id])[row.id] || []);
  emitChannel(row.channel_id, { type: "message.update", message: next });
  json(res, 200, { message: next });
});

route("DELETE", "/api/messages/:id", async (req, res, p, _b, user) => {
  const row = q.messageById.get(p.id);
  if (!row) return json(res, 404, { error: "Message not found." });
  const channel = q.channelById.get(row.channel_id);
  const server = channel?.server_id ? q.serverById.get(channel.server_id) : null;
  const allowed = row.author_id === user.id || (server && isOwner(server, user.id));
  if (!allowed) return json(res, 403, { error: "Cannot delete this message." });
  q.deleteMessage.run(row.id);
  emitChannel(row.channel_id, { type: "message.delete", message_id: row.id, channel_id: row.channel_id });
  json(res, 200, { ok: true });
});

route("PUT", "/api/messages/:id/pin", async (req, res, p, _b, user) => {
  const row = q.messageById.get(p.id);
  if (!row) return json(res, 404, { error: "Message not found." });
  const channel = q.channelById.get(row.channel_id);
  if (!channel || !canSeeChannel(user.id, channel)) return json(res, 404, { error: "Not found." });
  q.pinMessage.run(1, row.id);
  const next = serializeMessage(q.messageById.get(row.id), reactionsMap([row.id])[row.id] || []);
  emitChannel(row.channel_id, { type: "message.update", message: next });
  json(res, 200, { message: next });
});

route("DELETE", "/api/messages/:id/pin", async (req, res, p, _b, user) => {
  const row = q.messageById.get(p.id);
  if (!row) return json(res, 404, { error: "Message not found." });
  q.pinMessage.run(0, row.id);
  const next = serializeMessage(q.messageById.get(row.id), reactionsMap([row.id])[row.id] || []);
  emitChannel(row.channel_id, { type: "message.update", message: next });
  json(res, 200, { message: next });
});

route("PUT", "/api/messages/:id/reactions/:emoji", async (req, res, p, _b, user) => {
  const row = q.messageById.get(p.id);
  if (!row) return json(res, 404, { error: "Message not found." });
  const emoji = decodeURIComponent(p.emoji).slice(0, 16);
  q.addReaction.run(row.id, user.id, emoji);
  const reactions = reactionsMap([row.id])[row.id] || [];
  emitChannel(row.channel_id, { type: "message.react", message_id: row.id, channel_id: row.channel_id, reactions });
  json(res, 200, { reactions });
});

route("DELETE", "/api/messages/:id/reactions/:emoji", async (req, res, p, _b, user) => {
  const row = q.messageById.get(p.id);
  if (!row) return json(res, 404, { error: "Message not found." });
  const emoji = decodeURIComponent(p.emoji).slice(0, 16);
  q.removeReaction.run(row.id, user.id, emoji);
  const reactions = reactionsMap([row.id])[row.id] || [];
  emitChannel(row.channel_id, { type: "message.react", message_id: row.id, channel_id: row.channel_id, reactions });
  json(res, 200, { reactions });
});

route("POST", "/api/servers/:id/invites", async (req, res, p, _b, user) => {
  const server = q.serverById.get(p.id);
  if (!server || !q.member.get(server.id, user.id)) return json(res, 404, { error: "Server not found." });
  const code = inviteCode();
  q.insertInvite.run(code, server.id, user.id, 0, now());
  json(res, 201, { invite: { code, server_id: server.id, uses: 0 } });
});

route("GET", "/api/servers/:id/invites", async (req, res, p, _b, user) => {
  const server = q.serverById.get(p.id);
  if (!server || !isOwner(server, user.id)) return json(res, 403, { error: "Forbidden." });
  json(res, 200, { invites: q.serverInvites.all(server.id) });
});

route("POST", "/api/invites/:code/join", async (req, res, p, _b, user) => {
  const inv = q.inviteByCode.get(p.code);
  if (!inv) return json(res, 404, { error: "Invite is invalid or expired." });
  if (inv.max_uses && inv.uses >= inv.max_uses) return json(res, 410, { error: "Invite has been used up." });
  if (q.member.get(inv.server_id, user.id)) {
    return json(res, 200, { server: hydrateServer(q.serverById.get(inv.server_id), user.id), already: true });
  }
  q.insertMember.run(inv.server_id, user.id, null, now());
  q.bumpInvite.run(inv.code);
  const server = hydrateServer(q.serverById.get(inv.server_id), user.id);
  emitServer(inv.server_id, { type: "member.add", server_id: inv.server_id, member: decorateUser(user) }, user.id);
  emitUser(user.id, { type: "server.create", server });
  json(res, 200, { server });
});

route("GET", "/api/invites/:code", async (req, res, p) => {
  const inv = q.inviteByCode.get(p.code);
  if (!inv) return json(res, 404, { error: "Invite not found." });
  const server = q.serverById.get(inv.server_id);
  const count = q.serverMembers.all(inv.server_id).length;
  json(res, 200, { code: inv.code, server: { id: server.id, name: server.name, icon: server.icon, members: count } });
}, { authRequired: false });

route("POST", "/api/friends", async (req, res, _p, body, user) => {
  let username = clampText(body.username || "", 40).trim();
  let tg = clampText(body.tag || "", 4);
  if (username.includes("#")) {
    const parts = username.split("#");
    username = parts[0];
    tg = parts[1];
  }
  const other = q.userByNameTag.get(username, tg);
  if (!other) return json(res, 404, { error: "No user with that name#tag." });
  if (other.id === user.id) return json(res, 400, { error: "You cannot friend yourself." });
  const existing = q.friendPair.get(user.id, other.id, other.id, user.id);
  if (existing?.status === "accepted") return json(res, 200, { ok: true, already: true });
  if (existing?.status === "pending") return json(res, 200, { ok: true, pending: true });
  if (existing?.status === "blocked") return json(res, 403, { error: "Cannot send this request." });
  const fid = id();
  const [a, b] = pairKey(user.id, other.id);
  q.insertFriend.run(fid, a, b, "pending", user.id, now());
  const row = { id: fid, user: decorateUser(other), status: "pending", requested_by: user.id };
  emitUser(user.id, { type: "friend.update", friend: row });
  emitUser(other.id, { type: "friend.update", friend: { id: fid, user: decorateUser(user), status: "pending", requested_by: user.id } });
  json(res, 201, { friend: row });
});

route("PUT", "/api/friends/:id", async (req, res, p, _b, user) => {
  const rows = q.userFriends.all(user.id, user.id);
  const f = rows.find((r) => r.id === p.id);
  if (!f) return json(res, 404, { error: "Request not found." });
  if (f.requested_by === user.id) return json(res, 400, { error: "You sent this request." });
  q.updateFriend.run("accepted", f.id);
  const otherId = f.user_a === user.id ? f.user_b : f.user_a;
  const other = decorateUser(q.userById.get(otherId));
  emitUser(user.id, { type: "friend.update", friend: { id: f.id, user: other, status: "accepted", requested_by: f.requested_by } });
  emitUser(otherId, { type: "friend.update", friend: { id: f.id, user: decorateUser(user), status: "accepted", requested_by: f.requested_by } });
  json(res, 200, { ok: true });
});

route("DELETE", "/api/friends/:id", async (req, res, p, _b, user) => {
  const rows = q.userFriends.all(user.id, user.id);
  const f = rows.find((r) => r.id === p.id);
  if (!f) return json(res, 404, { error: "Not found." });
  const otherId = f.user_a === user.id ? f.user_b : f.user_a;
  q.deleteFriend.run(f.id);
  emitUser(user.id, { type: "friend.remove", id: f.id });
  emitUser(otherId, { type: "friend.remove", id: f.id });
  json(res, 200, { ok: true });
});

route("POST", "/api/dms", async (req, res, _p, body, user) => {
  const other = q.userById.get(body.user_id);
  if (!other) return json(res, 404, { error: "User not found." });
  let ch = q.dmForUsers.get(user.id, other.id);
  if (!ch) {
    const cid = id();
    q.insertChannel.run(cid, null, "dm", "dm", "", 0, null, now());
    q.insertDmPart.run(cid, user.id);
    q.insertDmPart.run(cid, other.id);
    ch = q.channelById.get(cid);
  }
  const dm = hydrateDm(ch, user.id);
  emitUser(user.id, { type: "dm.create", channel: dm });
  emitUser(other.id, { type: "dm.create", channel: hydrateDm(ch, other.id) });
  json(res, 200, { channel: dm });
});

route("POST", "/api/read", async (req, res, _p, body, user) => {
  if (!body.channel_id) return json(res, 400, { error: "channel_id required." });
  q.setRead.run(user.id, body.channel_id, body.last_read || "");
  json(res, 200, { ok: true });
});

route("POST", "/api/upload", async (req, res, _p, _b, user) => {
  const raw = await readBody(req);
  if (!raw.length) return json(res, 400, { error: "Empty file." });
  if (raw.length > 12 * 1024 * 1024) return json(res, 413, { error: "File too large (12 MB max)." });
  const original = clampText(req.headers["x-filename"] || "file.bin", 180).replace(/[^\w.\-]+/g, "_");
  const ext = extname(original).toLowerCase() || ".bin";
  const allowed = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp3", ".ogg", ".wav", ".txt", ".pdf", ".zip"]);
  if (!allowed.has(ext)) return json(res, 400, { error: "File type not allowed." });
  const fid = id() + ext;
  writeFileSync(join(UPLOAD_DIR, fid), raw);
  const kind = req.headers["x-kind"] === "avatar" ? "avatar" : "attachment";
  const url = `/uploads/${fid}`;
  if (kind === "avatar") {
    q.updateUser.run(user.display_name, user.bio, user.status, user.custom_status, url, user.avatar_color, user.banner_color, user.id);
    const next = q.userById.get(user.id);
    emitUser(user.id, { type: "user.update", user: publicUser(next, { includeEmail: true }) });
  }
  json(res, 201, { url, filename: original, size: raw.length, mime: MIME[ext] || "application/octet-stream" });
});

route("POST", "/api/servers/:id/kick/:userId", async (req, res, p, _b, user) => {
  const server = q.serverById.get(p.id);
  if (!server || !isOwner(server, user.id)) return json(res, 403, { error: "Forbidden." });
  if (p.userId === user.id) return json(res, 400, { error: "You cannot kick yourself." });
  q.deleteMember.run(server.id, p.userId);
  emitServer(server.id, { type: "member.remove", server_id: server.id, user_id: p.userId });
  emitUser(p.userId, { type: "server.delete", server_id: server.id });
  json(res, 200, { ok: true });
});

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  if (path.startsWith("/uploads/")) {
    const name = path.slice("/uploads/".length);
    if (name.includes("..") || name.includes("/")) {
      res.writeHead(400);
      return res.end();
    }
    const file = join(UPLOAD_DIR, name);
    if (!existsSync(file)) {
      res.writeHead(404);
      return res.end("not found");
    }
    const ext = extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "public, max-age=31536000" });
    return res.end(readFileSync(file));
  }

  if (path.startsWith("/api/")) {
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = path.match(r.re);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => {
          params[k] = decodeURIComponent(m[i + 1]);
        });
        let user = null;
        if (r.authRequired) {
          user = auth(req);
          if (!user) return json(res, 401, { error: "Unauthorized." });
        }
        let body = {};
        if (req.method !== "GET" && path !== "/api/upload") {
          const raw = await readBody(req, 2 * 1024 * 1024);
          if (raw.length) {
            try {
              body = JSON.parse(raw.toString("utf8"));
            } catch {
              return json(res, 400, { error: "Invalid JSON." });
            }
          }
        }
        return await r.handler(req, res, params, body, user);
      }
      return json(res, 404, { error: "Not found." });
    } catch (err) {
      console.error(err);
      return json(res, err.status || 500, { error: err.message || "Server error." });
    }
  }

  const root = clientDir();
  if (root) {
    let rel = path === "/" ? "/index.html" : path;
    const candidate = resolve(root, "." + normalize(rel));
    if (candidate.startsWith(resolve(root)) && existsSync(candidate) && statSync(candidate).isFile()) {
      const ext = extname(candidate).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      return res.end(readFileSync(candidate));
    }
    const index = join(root, "index.html");
    if (existsSync(index)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(readFileSync(index));
    }
  }

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Hearth server is running. Build the client with `npm run build` or use `npm run dev`.\nSource: " + SOURCE_URL + "\n");
});

const wss = new WebSocketServer({ server, path: "/ws" });

function attach(ws, user) {
  sockets.set(ws, { userId: user.id });
  if (!online.has(user.id)) online.set(user.id, new Set());
  online.get(user.id).add(ws);
  send(ws, readyPayload(user));
  for (const s of userServers(user.id)) {
    emitServer(s.id, { type: "presence", user: decorateUser(user) }, user.id);
  }
}

function detach(ws) {
  const meta = sockets.get(ws);
  sockets.delete(ws);
  if (!meta) return;
  const set = online.get(meta.userId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) {
      online.delete(meta.userId);
      const vs = voice.get(meta.userId);
      if (vs) {
        voice.delete(meta.userId);
        emitChannel(vs.channel_id, { type: "voice.leave", user_id: meta.userId, channel_id: vs.channel_id });
      }
      const user = q.userById.get(meta.userId);
      if (user) {
        for (const s of userServers(user.id)) {
          emitServer(s.id, { type: "presence", user: decorateUser(user) });
        }
      }
    }
  }
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://local");
  const tok = url.searchParams.get("token") || "";
  const user = tok ? q.sessionUser.get(tok) : null;
  if (user) attach(ws, user);

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    const meta = sockets.get(ws);
    if (!meta) {
      if (msg.type === "auth") {
        const u = q.sessionUser.get(msg.token || "");
        if (u) attach(ws, u);
        else send(ws, { type: "error", error: "Invalid token." });
      }
      return;
    }
    const me = q.userById.get(meta.userId);
    if (!me) return;

    if (msg.type === "typing") {
      const ch = q.channelById.get(msg.channel_id);
      if (ch && canSeeChannel(me.id, ch)) {
        emitChannel(ch.id, { type: "typing", channel_id: ch.id, user: decorateUser(me) }, me.id);
      }
    }

    if (msg.type === "presence" && ["online", "idle", "dnd", "invisible"].includes(msg.status)) {
      q.updateUser.run(me.display_name, me.bio, msg.status, me.custom_status, me.avatar, me.avatar_color, me.banner_color, me.id);
      const next = q.userById.get(me.id);
      for (const s of userServers(me.id)) emitServer(s.id, { type: "presence", user: decorateUser(next) });
    }

    if (msg.type === "voice.join") {
      const ch = q.channelById.get(msg.channel_id);
      if (!ch || ch.type !== "voice" || !canSeeChannel(me.id, ch)) return;
      const prev = voice.get(me.id);
      if (prev && prev.channel_id !== ch.id) {
        emitChannel(prev.channel_id, { type: "voice.leave", user_id: me.id, channel_id: prev.channel_id });
      }
      const state = {
        channel_id: ch.id,
        muted: Boolean(msg.muted),
        deafened: Boolean(msg.deafened),
        streaming: Boolean(msg.streaming),
      };
      voice.set(me.id, state);
      const peers = [...voice.entries()]
        .filter(([uid, st]) => uid !== me.id && st.channel_id === ch.id)
        .map(([uid]) => uid);
      emitChannel(ch.id, { type: "voice.join", user_id: me.id, user: decorateUser(me), ...state, peers });
    }

    if (msg.type === "voice.state") {
      const st = voice.get(me.id);
      if (!st) return;
      st.muted = Boolean(msg.muted);
      st.deafened = Boolean(msg.deafened);
      st.streaming = Boolean(msg.streaming);
      emitChannel(st.channel_id, { type: "voice.state", user_id: me.id, ...st });
    }

    if (msg.type === "voice.leave") {
      const st = voice.get(me.id);
      if (!st) return;
      voice.delete(me.id);
      emitChannel(st.channel_id, { type: "voice.leave", user_id: me.id, channel_id: st.channel_id });
    }

    if (msg.type === "rtc" && msg.to && msg.data) {
      emitUser(msg.to, { type: "rtc", from: me.id, data: msg.data });
    }
  });

  ws.on("close", () => detach(ws));
  ws.on("error", () => detach(ws));
});

server.listen(PORT, HOST, () => {
  console.log(`Hearth server listening on http://${HOST}:${PORT}`);
  console.log(`Source: ${SOURCE_URL}`);
});
