import http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, createReadStream } from "node:fs";
import { extname, join, dirname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { db, q, DATA_DIR, UPLOAD_DIR, reactionsMap } from "./db.js";
import {
  seedBuiltinPacks,
  ensureInstalled,
  serializePack,
  serializeSticker,
  sq,
  canEditPack,
  stickerAttachment,
  markRecent,
  slugify,
} from "./stickers.js";
import { connectPage } from "./connect-page.js";
import { spawnSync } from "node:child_process";
import {
  loadGate,
  gateRequired,
  extractGate,
  gateOk,
  setGateCookie,
  rateLimit,
  takeTurn,
  ipKey,
  dummyVerify,
  isPublicHop,
} from "./harden.js";
import {
  id,
  token,
  tag,
  inviteCode,
  hashPassword,
  verifyPassword,
  now,
  publicUser,
  privacyOf,
  colorFor,
  validUsername,
  validPassword,
  clampText,
} from "./util.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.env.HEARTH_PORT || 3928);
const HOST = process.env.HEARTH_HOST || "0.0.0.0";
const SOURCE_URL = process.env.HEARTH_SOURCE || "https://github.com/IAmXMob69/BloodLink";
const OPEN_SIGNUP = process.env.HEARTH_OPEN_SIGNUP === "1";
const SESSION_MS = Number(process.env.HEARTH_SESSION_DAYS || 7) * 86400000;
const CORS_ALLOW = (process.env.HEARTH_CORS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PUBLIC_URL_FILE = process.env.HEARTH_PUBLIC_URL_FILE || join(DATA_DIR, "public-url");

function ensureHostZip() {
  const outDir = join(DATA_DIR, "host-pack");
  mkdirSync(outDir, { recursive: true });
  const zip = join(outDir, "BloodLink-Host.zip");
  const root = join(__dirname, "..", "..");
  const script = join(root, "scripts", "make-host.sh");
  const marks = [script, join(root, "HOST-START-HERE.txt"), join(root, "package.json"), join(root, "install-linux.sh")];
  let fresh = existsSync(zip);
  if (fresh) {
    const zt = statSync(zip).mtimeMs;
    for (const f of marks) {
      if (existsSync(f) && statSync(f).mtimeMs > zt) {
        fresh = false;
        break;
      }
    }
  }
  if (!fresh) {
    const r = spawnSync("bash", [script, join(outDir, "BloodLink-Host")], {
      encoding: "utf8",
      env: { ...process.env },
      cwd: root,
    });
    if (r.status !== 0 || !existsSync(zip)) {
      console.error("make-host failed", r.status, r.stdout, r.stderr);
      return null;
    }
  }
  return zip;
}

function publicUrl() {
  const env = (process.env.HEARTH_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (env) return env;
  try {
    if (existsSync(PUBLIC_URL_FILE)) {
      return readFileSync(PUBLIC_URL_FILE, "utf8").trim().replace(/\/$/, "");
    }
  } catch {
    /* ignore */
  }
  return "";
}

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
const GATE = loadGate(DATA_DIR);

function ensureAppInvite() {
  const file = join(DATA_DIR, "app-invite");
  if (existsSync(file)) {
    const code = readFileSync(file, "utf8").trim();
    if (code && q.inviteByCode.get(code)) return code;
  }
  const first = db.prepare("SELECT id, owner_id FROM servers ORDER BY created_at LIMIT 1").get();
  if (!first) return "";
  const code = inviteCode();
  q.insertInvite.run(code, first.id, first.owner_id || null, 0, now());
  writeFileSync(file, code, { mode: 0o600 });
  return code;
}
const APP_INVITE = ensureAppInvite();
seedBuiltinPacks();

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
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".ogv": "video/ogg",
};

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".m4v", ".ogv"]);
const AUDIO_EXT = new Set([".mp3", ".ogg", ".wav", ".m4a", ".flac"]);
const DOC_EXT = new Set([".txt", ".pdf", ".zip"]);
const ATTACH_EXT = new Set([...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT, ...DOC_EXT]);
const MAX_UPLOAD = Number(process.env.HEARTH_UPLOAD_MAX || 80 * 1024 * 1024);
const MAX_AVATAR = 8 * 1024 * 1024;

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
  if (!privacyOf(user).presence) return "offline";
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

function sanitizeAttachments(list) {
  const out = [];
  for (const a of (Array.isArray(list) ? list : []).slice(0, 8)) {
    if (!a || typeof a !== "object") continue;
    const url = String(a.url || "");
    if (!url.startsWith("/uploads/") || url.includes("..") || url.includes("\\")) continue;
    const name = url.slice("/uploads/".length);
    if (!name || name.includes("/")) continue;
    if (!existsSync(join(UPLOAD_DIR, name))) continue;
    const ext = extname(name).toLowerCase();
    if (!ATTACH_EXT.has(ext)) continue;
    const item = {
      url,
      filename: clampText(String(a.filename || name), 180),
      size: Number(a.size) || 0,
      mime: MIME[ext] || "application/octet-stream",
    };
    if (a.kind === "sticker") {
      item.kind = "sticker";
      if (a.sticker_id) item.sticker_id = clampText(String(a.sticker_id), 40);
      if (a.emoji) item.emoji = clampText(String(a.emoji), 16);
      if (a.pack_id) item.pack_id = clampText(String(a.pack_id), 40);
    }
    out.push(item);
  }
  return out;
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
    user: publicUser(user, { includeEmail: true, includePrivacy: true }),
    servers,
    dms,
    friends,
    pending,
    reads,
    voice_states: [...voice.entries()].map(([uid, st]) => ({ user_id: uid, ...st })),
    source_url: SOURCE_URL,
    public_url: publicUrl(),
    gate: GATE,
  };
}

function createDefaultServer(user) {
  const sid = id();
  const t = now();
  q.insertServer.run(sid, `${user.display_name || user.username}'s server`, null, user.id, "Welcome to BloodLink.", t);
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
      `Welcome to **${user.display_name || user.username}'s server**. This is BloodLink — invite friends with the code \`${code}\`.`,
      null,
      "[]",
      0,
      1,
      t,
      0,
      null
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

function sendUpload(req, res, file, contentType) {
  const st = statSync(file);
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? Number(m[1]) : 0;
    const end = m && m[2] ? Number(m[2]) : st.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start >= st.size || end >= st.size || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, {
      "Content-Type": contentType,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${st.size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000",
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": st.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000",
  });
  createReadStream(file).pipe(res);
}

function stealth404(res) {
  securityHeaders(res);
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end("Not Found");
}

function securityHeaders(res, { html = false, https = false } = {}) {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  if (https) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (html) {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; object-src 'none'"
    );
  }
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  securityHeaders(res);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  };
  if (status === 429 && data?.retry_after) {
    headers["Retry-After"] = String(data.retry_after);
  }
  res.writeHead(status, headers);
  res.end(body);
}

function tooFast(res, retryAfter, error) {
  json(res, 429, { error, retry_after: retryAfter });
  return true;
}

/** Twitter-style short timeout on sends so bots cannot flood the host. */
function sendTimeout(req, res, user) {
  const gapMs = Number(process.env.HEARTH_MSG_GAP_MS || 2000);
  const uid = user.id;
  const gap = takeTurn(`msg-gap:${uid}`, { minGapMs: gapMs, windowMs: Math.max(gapMs, 2000) });
  if (!gap.ok) {
    return tooFast(res, gap.retryAfter, `You're sending too fast. Wait ${gap.retryAfter}s.`);
  }
  const burst = takeTurn(`msg-burst:${uid}`, { max: 6, windowMs: 20_000, lockMs: 30_000 });
  if (!burst.ok) {
    return tooFast(res, burst.retryAfter, `Timeout — try again in ${burst.retryAfter}s.`);
  }
  const window = takeTurn(`msg-win:${uid}`, { max: 50, windowMs: 15 * 60_000, lockMs: 10 * 60_000 });
  if (!window.ok) {
    const mins = Math.max(1, Math.ceil(window.retryAfter / 60));
    return tooFast(res, window.retryAfter, `Send limit reached. Try again in ${mins} min.`);
  }
  const ip = takeTurn(`msg-ip:${ipKey(req)}`, { max: 12, windowMs: 20_000, lockMs: 60_000 });
  if (!ip.ok) {
    return tooFast(res, ip.retryAfter, `This connection is sending too fast. Wait ${ip.retryAfter}s.`);
  }
  return false;
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const pub = publicUrl();
  const fromTunnel =
    /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin) ||
    /^https:\/\/[a-z0-9.-]+\.(localhost\.run|lhr\.life|serveo\.net)$/.test(origin) ||
    (pub && origin.replace(/\/$/, "") === pub);
  if (CORS_ALLOW.includes("*") || CORS_ALLOW.includes(origin) || local || fromTunnel) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Filename, X-Kind, X-Hearth-Gate");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  }
}

function auth(req) {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!tok) return null;
  const user = q.sessionUser.get(tok);
  if (!user) return null;
  const sess = db.prepare("SELECT created_at FROM sessions WHERE token = ?").get(tok);
  if (sess && SESSION_MS > 0 && now() - sess.created_at > SESSION_MS) {
    q.deleteSession.run(tok);
    return null;
  }
  return user;
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
  json(res, 200, {
    ok: true,
    invite_only: !OPEN_SIGNUP,
    sealed_dms: true,
    public_url: publicUrl() || "",
  });
}, { authRequired: false });

route("GET", "/api/source", async (_req, res) => {
  json(res, 200, { source: SOURCE_URL, license: "AGPL-3.0-or-later" });
}, { authRequired: false });

route("POST", "/api/register", async (req, res, _p, body) => {
  const username = clampText(body.username || "", 32).trim();
  const password = body.password || "";
  const email = clampText(body.email || "", 120).trim().toLowerCase() || null;
  const display = clampText(body.display_name || username, 32);
  const users = q.userCount.get().n;
  const inviteCodeIn = clampText(body.invite || "", 32).trim();
  if (!OPEN_SIGNUP && users > 0) {
    const inv = inviteCodeIn ? q.inviteByCode.get(inviteCodeIn) : null;
    if (!inv) {
      return json(res, 403, { error: "This BloodLink is invite-only. Ask a member for an invite code." });
    }
  }
  if (!validUsername(username)) {
    return json(res, 400, { error: "Username must be 2–32 letters, numbers, or underscores." });
  }
  if (!rateLimit(req, "reg", 3, 15 * 60 * 1000)) {
    return json(res, 429, {
      error: "Too many sign-up attempts. Try later.",
      retry_after: rateLimit.retryAfter || 60,
    });
  }
  if (!validPassword(password, username)) {
    return json(res, 400, { error: "Password must be at least 10 characters and include a letter and a number." });
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
  q.updatePrivacy.run(JSON.stringify({ presence: false, typing: false, dms: "friends", vanish_hours: 0 }), uid);
  const tok = token();
  q.insertSession.run(tok, uid, tnow);
  const user = q.userById.get(uid);
  const inv = inviteCodeIn ? q.inviteByCode.get(inviteCodeIn) : null;
  let invite = null;
  if (inv) {
    q.insertMember.run(inv.server_id, uid, null, tnow);
    q.bumpInvite.run(inv.code);
    invite = inv.code;
  } else if (users === 0) {
    const created = createDefaultServer(user);
    invite = created.invite;
  }
  ensureInstalled(uid);
  json(res, 201, { token: tok, user: publicUser(user, { includeEmail: true, includePrivacy: true }), invite });
}, { authRequired: false });

route("POST", "/api/login", async (req, res, _p, body) => {
  if (!rateLimit(req, "login", 8, 10 * 60 * 1000)) {
    return json(res, 429, {
      error: "Too many login attempts. Try later.",
      retry_after: rateLimit.retryAfter || 60,
    });
  }
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
  if (!user) {
    await dummyVerify(password);
    return json(res, 401, { error: "Invalid username or password." });
  }
  if (!(await verifyPassword(password, user.password_hash))) {
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
  json(res, 200, { user: publicUser(user, { includeEmail: true, includePrivacy: true }) });
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
  if (body.pubkey !== undefined) {
    const pk = typeof body.pubkey === "string" ? body.pubkey.slice(0, 4000) : JSON.stringify(body.pubkey).slice(0, 4000);
    q.updatePubkey.run(pk, user.id);
  }
  if (body.privacy && typeof body.privacy === "object") {
    const cur = privacyOf(user);
    const nextP = {
      presence: body.privacy.presence !== undefined ? Boolean(body.privacy.presence) : cur.presence,
      typing: body.privacy.typing !== undefined ? Boolean(body.privacy.typing) : cur.typing,
      dms: ["anyone", "friends", "nobody"].includes(body.privacy.dms) ? body.privacy.dms : cur.dms,
      vanish_hours: body.privacy.vanish_hours !== undefined ? Math.max(0, Number(body.privacy.vanish_hours) || 0) : cur.vanish_hours,
    };
    q.updatePrivacy.run(JSON.stringify(nextP), user.id);
  }
  const next = q.userById.get(user.id);
  for (const s of userServers(user.id)) {
    emitServer(s.id, { type: "presence", user: decorateUser(next) });
  }
  emitUser(user.id, { type: "user.update", user: publicUser(next, { includeEmail: true, includePrivacy: true }) });
  json(res, 200, { user: publicUser(next, { includeEmail: true, includePrivacy: true }) });
});

route("DELETE", "/api/me", async (req, res, _p, _b, user) => {
  const owned = db.prepare("SELECT id FROM servers WHERE owner_id = ?").all(user.id);
  for (const s of owned) {
    emitServer(s.id, { type: "server.delete", server_id: s.id });
    q.deleteServer.run(s.id);
  }
  q.scrubAuthor.run(user.id);
  q.deleteUserSessions.run(user.id);
  q.deleteUser.run(user.id);
  emitUser(user.id, { type: "bye" });
  json(res, 200, { ok: true });
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
  q.purgeExpired.run(now());
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
  if (sendTimeout(req, res, user)) return;
  const content = clampText(body.content || "", 4000);
  let attachments = sanitizeAttachments(body.attachments);
  if (body.sticker_id) {
    const st = sq.stickerById.get(String(body.sticker_id));
    if (!st) return json(res, 404, { error: "Sticker not found." });
    attachments = [stickerAttachment(st)];
    markRecent(user.id, st.id);
  }
  if (!content.trim() && !attachments.length) return json(res, 400, { error: "Message is empty." });
  const mid = id();
  const sealed = content.startsWith("e2e:1:");
  const priv = privacyOf(user);
  let expires = null;
  if (channel.type === "dm" && priv.vanish_hours > 0) {
    expires = now() + priv.vanish_hours * 3600000;
  }
  q.purgeExpired.run(now());
  q.insertMessage.run(
    mid,
    channel.id,
    user.id,
    content,
    body.reply_to || null,
    JSON.stringify(attachments),
    0,
    0,
    now(),
    sealed ? 1 : 0,
    expires
  );
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
  json(res, 200, { ok: true });
}, { authRequired: false });

route("POST", "/api/friends", async (req, res, _p, body, user) => {
  const fr = takeTurn(`friend:${user.id}`, { max: 8, windowMs: 10 * 60_000, lockMs: 10 * 60_000 });
  if (!fr.ok) {
    return json(res, 429, {
      error: `Too many friend requests. Try again in ${Math.ceil(fr.retryAfter / 60)} min.`,
      retry_after: fr.retryAfter,
    });
  }
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
  const pol = privacyOf(other).dms;
  if (pol === "nobody" && other.id !== user.id) {
    return json(res, 403, { error: "This person is not accepting direct messages." });
  }
  if (pol === "friends") {
    const f = q.friendPair.get(user.id, other.id, other.id, user.id);
    if (!f || f.status !== "accepted") {
      return json(res, 403, { error: "Only friends can message this person." });
    }
  }
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

route("GET", "/api/stickers/picker", async (_req, res, _p, _b, user) => {
  ensureInstalled(user.id);
  const installed = sq.installedPacks.all(user.id).map((p) =>
    serializePack(p, { stickers: sq.stickersInPack.all(p.id), installed: true })
  );
  const have = new Set(installed.map((p) => p.id));
  const catalog = sq.allPacks.all().map((p) => serializePack(p, { installed: have.has(p.id) }));
  json(res, 200, {
    installed,
    recent: sq.recentStickers.all(user.id).map(serializeSticker),
    catalog,
  });
});

route("GET", "/api/sticker-packs", async (_req, res, _p, _b, user) => {
  ensureInstalled(user.id);
  const have = new Set(sq.installedPacks.all(user.id).map((p) => p.id));
  json(res, 200, { packs: sq.allPacks.all().map((p) => serializePack(p, { installed: have.has(p.id) })) });
});

route("GET", "/api/sticker-packs/:id", async (_req, res, p, _b, user) => {
  const pack = sq.packById.get(p.id);
  if (!pack) return json(res, 404, { error: "Pack not found." });
  json(res, 200, {
    pack: serializePack(pack, {
      stickers: sq.stickersInPack.all(pack.id),
      installed: Boolean(sq.installedRow.get(user.id, pack.id)),
    }),
  });
});

route("POST", "/api/sticker-packs", async (_req, res, _p, body, user) => {
  const name = clampText(body.name || "", 40).trim();
  if (name.length < 2) return json(res, 400, { error: "Pack name must be at least 2 characters." });
  const description = clampText(body.description || "", 200);
  const slug = slugify(name);
  const pid = id();
  sq.insertPack.run(pid, slug, name, description, null, user.id, 0, now());
  const pos = sq.nextInstallPos.get(user.id).n;
  sq.installPack.run(user.id, pid, pos);
  const pack = sq.packById.get(pid);
  json(res, 201, { pack: serializePack(pack, { stickers: [], installed: true }) });
});

route("PATCH", "/api/sticker-packs/:id", async (_req, res, p, body, user) => {
  const pack = sq.packById.get(p.id);
  if (!pack) return json(res, 404, { error: "Pack not found." });
  if (!canEditPack(pack, user.id)) return json(res, 403, { error: "You cannot edit this pack." });
  const name = clampText(body.name ?? pack.name, 40).trim() || pack.name;
  const description = clampText(body.description ?? pack.description ?? "", 200);
  const cover = body.cover_url && String(body.cover_url).startsWith("/uploads/") ? String(body.cover_url) : pack.cover_url;
  sq.updatePack.run(name, description, cover, pack.id);
  json(res, 200, { pack: serializePack(sq.packById.get(pack.id), { installed: Boolean(sq.installedRow.get(user.id, pack.id)) }) });
});

route("DELETE", "/api/sticker-packs/:id", async (_req, res, p, _b, user) => {
  const pack = sq.packById.get(p.id);
  if (!pack) return json(res, 404, { error: "Pack not found." });
  if (pack.builtin) return json(res, 403, { error: "Built-in packs cannot be deleted." });
  if (!canEditPack(pack, user.id)) return json(res, 403, { error: "You cannot delete this pack." });
  sq.deletePack.run(pack.id);
  json(res, 200, { ok: true });
});

route("POST", "/api/sticker-packs/:id/stickers", async (_req, res, p, body, user) => {
  const pack = sq.packById.get(p.id);
  if (!pack) return json(res, 404, { error: "Pack not found." });
  if (!canEditPack(pack, user.id)) return json(res, 403, { error: "You cannot add stickers to this pack." });
  if (sq.stickerCount.get(pack.id).n >= 80) return json(res, 400, { error: "A pack can hold 80 stickers." });
  const url = String(body.url || "");
  if (!url.startsWith("/uploads/") || url.includes("..") || url.includes("/uploads/../")) {
    return json(res, 400, { error: "Upload the image first." });
  }
  const name = url.slice("/uploads/".length);
  if (!name || name.includes("/")) return json(res, 400, { error: "Invalid sticker file." });
  if (!existsSync(join(UPLOAD_DIR, name))) return json(res, 400, { error: "Sticker file is missing." });
  const ext = extname(name).toLowerCase();
  if (!IMAGE_EXT.has(ext)) return json(res, 400, { error: "Stickers must be PNG, JPEG, GIF, or WebP." });
  const sid = id();
  const sort = sq.nextSort.get(pack.id).n;
  sq.insertSticker.run(
    sid,
    pack.id,
    clampText(body.emoji || "✨", 16),
    url,
    clampText(body.filename || name, 180),
    MIME[ext] || "image/png",
    sort,
    now()
  );
  if (!pack.cover_url) sq.updatePack.run(pack.name, pack.description, url, pack.id);
  const st = sq.stickerById.get(sid);
  json(res, 201, { sticker: serializeSticker(st) });
});

route("DELETE", "/api/sticker-packs/:id/stickers/:sid", async (_req, res, p, _b, user) => {
  const pack = sq.packById.get(p.id);
  if (!pack) return json(res, 404, { error: "Pack not found." });
  if (!canEditPack(pack, user.id)) return json(res, 403, { error: "You cannot edit this pack." });
  const st = sq.stickerById.get(p.sid);
  if (!st || st.pack_id !== pack.id) return json(res, 404, { error: "Sticker not found." });
  sq.deleteSticker.run(st.id);
  if (pack.cover_url === st.url) {
    const next = sq.stickersInPack.all(pack.id)[0];
    sq.updatePack.run(pack.name, pack.description, next?.url || null, pack.id);
  }
  json(res, 200, { ok: true });
});

route("POST", "/api/sticker-packs/:id/install", async (_req, res, p, _b, user) => {
  const pack = sq.packById.get(p.id);
  if (!pack) return json(res, 404, { error: "Pack not found." });
  const pos = sq.nextInstallPos.get(user.id).n;
  sq.installPack.run(user.id, pack.id, pos);
  json(res, 200, { ok: true, pack: serializePack(pack, { stickers: sq.stickersInPack.all(pack.id), installed: true }) });
});

route("DELETE", "/api/sticker-packs/:id/install", async (_req, res, p, _b, user) => {
  const pack = sq.packById.get(p.id);
  if (!pack) return json(res, 404, { error: "Pack not found." });
  sq.uninstallPack.run(user.id, pack.id);
  json(res, 200, { ok: true });
});

route("POST", "/api/upload", async (req, res, _p, _b, user) => {
  const up = takeTurn(`up:${user.id}`, { max: 4, windowMs: 30_000, lockMs: 30_000, minGapMs: 1000 });
  if (!up.ok) {
    return json(res, 429, {
      error: `Upload timeout — try again in ${up.retryAfter}s.`,
      retry_after: up.retryAfter,
    });
  }
  const rawKind = String(req.headers["x-kind"] || "attachment");
  const kind = rawKind === "avatar" || rawKind === "sticker" ? rawKind : "attachment";
  const original = clampText(req.headers["x-filename"] || "file.bin", 180).replace(/[^\w.\-]+/g, "_");
  const ext = extname(original).toLowerCase() || ".bin";
  const allow = kind === "avatar" || kind === "sticker" ? IMAGE_EXT : ATTACH_EXT;
  if (!allow.has(ext)) {
    return json(res, 400, {
      error:
        kind === "avatar"
          ? "Avatar must be a PNG, JPEG, GIF, or WebP."
          : kind === "sticker"
            ? "Stickers must be PNG, JPEG, GIF, or WebP."
            : "That file type is not allowed. Use a video (mp4, webm, mov), image, audio, PDF, or zip.",
    });
  }
  const cap = kind === "avatar" ? MAX_AVATAR : kind === "sticker" ? 2 * 1024 * 1024 : VIDEO_EXT.has(ext) ? MAX_UPLOAD : 16 * 1024 * 1024;
  const raw = await readBody(req, cap);
  if (!raw.length) return json(res, 400, { error: "Empty file." });
  if (raw.length > cap) {
    const mb = Math.round(cap / (1024 * 1024));
    return json(res, 413, { error: `File too large (${mb} MB max).` });
  }
  const fid = id() + ext;
  writeFileSync(join(UPLOAD_DIR, fid), raw);
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
  const httpsHop = req.headers["x-forwarded-proto"] === "https" || req.headers["cf-visitor"]?.includes("https");
  cors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  const providedGate = extractGate(req, url);
  const allowed = !gateRequired(req) || gateOk(providedGate, GATE);
  if (gateOk(providedGate, GATE) && gateRequired(req)) {
    setGateCookie(res, GATE, httpsHop);
  }
  if (!allowed) return stealth404(res);
  if (!rateLimit(req, "all", 180, 60 * 1000)) {
    if (path.startsWith("/api/")) {
      return json(res, 429, {
        error: "Too many requests. Slow down.",
        retry_after: rateLimit.retryAfter || 30,
      });
    }
    return stealth404(res);
  }

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
    return sendUpload(req, res, file, MIME[ext] || "application/octet-stream");
  }

  if (path === "/download" || path === "/get" || path === "/join") {
    const invite = url.searchParams.get("invite") || APP_INVITE || "";
    const html = connectPage({ publicUrl: publicUrl(), invite, gate: GATE });
    securityHeaders(res, { html: true });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  if (path === "/download/Hearth-Connect.zip" || path === "/download/BloodLink-Connect.zip") {
    const invite = url.searchParams.get("invite") || APP_INVITE || "";
    const outDir = join(DATA_DIR, "connect-pack");
    const script = join(__dirname, "..", "..", "scripts", "make-connect.js");
    const r = spawnSync(process.execPath, [script, invite, join(outDir, "BloodLink-Connect")], {
      env: { ...process.env, HEARTH_DATA: DATA_DIR, HEARTH_PUBLIC_URL: publicUrl(), HEARTH_GATE: GATE },
      encoding: "utf8",
    });
    const zip = join(outDir, "BloodLink-Connect.zip");
    if (r.status !== 0 || !existsSync(zip)) {
      return json(res, 503, { error: "Could not build the Connect app. Is the public tunnel up?" });
    }
    securityHeaders(res);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="BloodLink-Connect.zip"',
      "Cache-Control": "no-store",
    });
    return res.end(readFileSync(zip));
  }

  if (path === "/download/BloodLink-Host.zip" || path === "/download/Hearth-Host.zip") {
    const zip = ensureHostZip();
    if (!zip) {
      return json(res, 503, { error: "Could not build the host pack. Try again in a moment." });
    }
    securityHeaders(res);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="BloodLink-Host.zip"',
      "Cache-Control": "no-store",
    });
    return res.end(readFileSync(zip));
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
      securityHeaders(res, { html: ext === ".html" });
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      return res.end(readFileSync(candidate));
    }
    const index = join(root, "index.html");
    if (existsSync(index)) {
      securityHeaders(res, { html: true });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(readFileSync(index));
    }
  }

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("BloodLink server is running. Build the client with `npm run build` or use `npm run dev`.\nSource: " + SOURCE_URL + "\n");
});

const wss = new WebSocketServer({
  server,
  path: "/ws",
  verifyClient(info, done) {
    const req = info.req;
    const u = new URL(req.url, "http://local");
    const g = extractGate(req, u);
    if (gateRequired(req) && !gateOk(g, GATE)) return done(false, 404, "Not Found");
    if (!rateLimit(req, "ws", 20, 60 * 1000)) return done(false, 429, "Too many");
    done(true);
  },
});

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

wss.on("connection", (ws) => {
  // Token is sent in the first auth frame — never in the URL (access logs).

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    const meta = sockets.get(ws);
    if (!meta) {
      if (msg.type === "ping") {
        send(ws, { type: "pong" });
        return;
      }
      if (msg.type === "auth") {
        const tok = msg.token || "";
        const u = q.sessionUser.get(tok);
        if (!u) {
          send(ws, { type: "error", error: "Invalid token." });
          return;
        }
        const sess = db.prepare("SELECT created_at FROM sessions WHERE token = ?").get(tok);
        if (sess && SESSION_MS > 0 && now() - sess.created_at > SESSION_MS) {
          q.deleteSession.run(tok);
          send(ws, { type: "error", error: "Invalid token." });
          return;
        }
        attach(ws, u);
      }
      return;
    }
    const me = q.userById.get(meta.userId);
    if (!me) return;

    if (msg.type === "ping") {
      send(ws, { type: "pong" });
      return;
    }

    const frames = takeTurn(`ws:${me.id}`, { max: 60, windowMs: 10_000, lockMs: 15_000 });
    if (!frames.ok) return;

    if (msg.type === "typing") {
      if (!privacyOf(me).typing) return;
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

    if (msg.type === "voice.frame") {
      const st = voice.get(me.id);
      if (!st || st.muted || st.deafened) return;
      const raw = typeof msg.data === "string" ? msg.data : "";
      if (!raw || raw.length > 32000) return;
      const rate = Number(msg.rate) || 48000;
      emitChannel(st.channel_id, { type: "voice.frame", from: me.id, data: raw, rate }, me.id);
    }
  });

  ws.on("close", () => detach(ws));
  ws.on("error", () => detach(ws));
});

server.listen(PORT, HOST, () => {
  console.log(`BloodLink server listening on http://${HOST}:${PORT}`);
  console.log(`This machine is the host. Friends only run the Connect app.`);
  console.log(`Source: ${SOURCE_URL}`);
});
