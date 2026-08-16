import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export function id() {
  return randomBytes(12).toString("hex");
}

export function token() {
  return randomBytes(32).toString("hex");
}

export function tag() {
  return String(randomInt(1, 10000)).padStart(4, "0");
}

export function inviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  const bytes = randomBytes(8);
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const buf = await scryptAsync(password, salt, 64);
  return `${salt}:${buf.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const buf = await scryptAsync(password, salt, 64);
  const a = Buffer.from(hash, "hex");
  if (a.length !== buf.length) return false;
  return timingSafeEqual(a, buf);
}

export function now() {
  return Date.now();
}

export function publicUser(user, { includeEmail = false } = {}) {
  if (!user) return null;
  const out = {
    id: user.id,
    username: user.username,
    tag: user.tag,
    display_name: user.display_name,
    avatar: user.avatar,
    avatar_color: user.avatar_color,
    banner_color: user.banner_color,
    bio: user.bio,
    status: user.status,
    custom_status: user.custom_status,
    created_at: user.created_at,
  };
  if (includeEmail) out.email = user.email;
  return out;
}

export const AVATAR_COLORS = [
  "#e85d04",
  "#f4a261",
  "#2a9d8f",
  "#e76f51",
  "#7c5cff",
  "#3d8bfd",
  "#23a559",
  "#eb459e",
  "#fee440",
  "#00bbf9",
];

export function colorFor(name) {
  let n = 0;
  for (let i = 0; i < name.length; i++) n = (n + name.charCodeAt(i) * (i + 1)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[n];
}

export function validUsername(name) {
  return typeof name === "string" && /^[a-zA-Z0-9_]{2,32}$/.test(name);
}

export function validPassword(pw) {
  return typeof pw === "string" && pw.length >= 8 && pw.length <= 128;
}

export function clampText(s, max) {
  if (typeof s !== "string") return "";
  return s.slice(0, max);
}

export const PERMS = {
  ADMIN: 1 << 0,
  MANAGE_SERVER: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  MANAGE_MESSAGES: 1 << 3,
  KICK: 1 << 4,
  SEND_MESSAGES: 1 << 5,
  CONNECT: 1 << 6,
  SPEAK: 1 << 7,
  MENTION_EVERYONE: 1 << 8,
};

export const DEFAULT_PERMS =
  PERMS.SEND_MESSAGES | PERMS.CONNECT | PERMS.SPEAK;

export function hasPerm(bits, perm) {
  return Boolean((bits & PERMS.ADMIN) === PERMS.ADMIN || (bits & perm) === perm);
}
