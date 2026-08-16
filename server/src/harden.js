import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { token, hashPassword, verifyPassword } from "./util.js";

const hits = new Map();
const locks = new Map();

function pruneMaps(t) {
  if (hits.size + locks.size < 8000) return;
  for (const [k, v] of hits) {
    const next = v.filter((x) => t - x < 20 * 60 * 1000);
    if (next.length) hits.set(k, next);
    else hits.delete(k);
  }
  for (const [k, until] of locks) {
    if (until < t) locks.delete(k);
  }
}

/** Sliding-window limiter with optional min-gap and penalty lock. */
export function takeTurn(key, { max, windowMs = 60_000, lockMs, minGapMs = 0 } = {}) {
  const t = Date.now();
  pruneMaps(t);
  const until = locks.get(key) || 0;
  if (t < until) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((until - t) / 1000)) };
  }
  const prev = (hits.get(key) || []).filter((x) => t - x < windowMs);
  if (minGapMs && prev.length) {
    const waitMs = minGapMs - (t - prev[prev.length - 1]);
    if (waitMs > 0) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil(waitMs / 1000)) };
    }
  }
  if (max != null && prev.length >= max) {
    const waitMs = lockMs != null ? lockMs : Math.max(1000, prev[0] + windowMs - t);
    locks.set(key, t + waitMs);
    return { ok: false, retryAfter: Math.max(1, Math.ceil(waitMs / 1000)) };
  }
  prev.push(t);
  hits.set(key, prev);
  return { ok: true, retryAfter: 0 };
}

export function ipKey(req) {
  return createHash("sha256").update(clientIp(req)).digest("hex").slice(0, 16);
}

export function loadGate(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const file = process.env.HEARTH_GATE_FILE || join(dataDir, "gate");
  if (process.env.HEARTH_GATE && process.env.HEARTH_GATE !== "0") {
    return process.env.HEARTH_GATE.trim();
  }
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const g = token();
  writeFileSync(file, g, { mode: 0o600 });
  return g;
}

export function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (cf && typeof cf === "string") return cf.split(",")[0].trim();
  const xff = req.headers["x-forwarded-for"];
  if (xff && typeof xff === "string") return xff.split(",")[0].trim();
  return (req.socket?.remoteAddress || "").replace("::ffff:", "");
}

export function isPublicHop(req) {
  return Boolean(
    req.headers["cf-ray"] ||
      req.headers["cf-connecting-ip"] ||
      req.headers["x-forwarded-for"] ||
      req.headers["cf-visitor"]
  );
}

export function isLoopback(req) {
  const ip = clientIp(req);
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

export function gateRequired(req) {
  if (process.env.HEARTH_GATE === "0") return false;
  if (isPublicHop(req)) return true;
  return !isLoopback(req);
}

export function extractGate(req, url) {
  const q = url?.searchParams?.get("g") || "";
  const h = req.headers["x-hearth-gate"] || "";
  const cookie = parseCookie(req.headers.cookie || "").hearth_gate || "";
  return String(q || h || cookie).trim();
}

export function gateOk(provided, expected) {
  if (!expected) return true;
  if (!provided || provided.length !== expected.length) {
    timingSafeEqual(Buffer.from("0".repeat(32)), Buffer.from("1".repeat(32)));
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

function parseCookie(raw) {
  const out = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setGateCookie(res, gate, secure) {
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=31536000"];
  if (secure) flags.push("Secure");
  res.setHeader("Set-Cookie", `hearth_gate=${encodeURIComponent(gate)}; ${flags.join("; ")}`);
}

export function rateLimit(req, bucket, max, windowMs) {
  const r = takeTurn(`${bucket}:${ipKey(req)}`, { max, windowMs });
  rateLimit.retryAfter = r.retryAfter;
  return r.ok;
}

export function fingerprint(req) {
  const ua = String(req.headers["user-agent"] || "");
  return createHash("sha256").update(clientIp(req) + "|" + ua).digest("hex").slice(0, 16);
}

let dummyHash = null;
export async function dummyVerify(password) {
  if (!dummyHash) dummyHash = await hashPassword("not-a-real-account-placeholder");
  await verifyPassword(password || "x", dummyHash);
}
