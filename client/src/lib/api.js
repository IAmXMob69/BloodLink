const KEY = "hearth.token";
const SERVER_KEY = "hearth.server";
const GATE_KEY = "hearth.gate";

export function getGate() {
  if (typeof location !== "undefined") {
    const g = new URLSearchParams(location.search).get("g");
    if (g) localStorage.setItem(GATE_KEY, g);
  }
  return localStorage.getItem(GATE_KEY) || "";
}

export function getToken() {
  return localStorage.getItem(KEY) || "";
}

export function setToken(t) {
  if (t) localStorage.setItem(KEY, t);
  else localStorage.removeItem(KEY);
}

export function getServerBase() {
  const stored = localStorage.getItem(SERVER_KEY);
  if (stored) return stored.replace(/\/$/, "");
  if (window.hearth?.serverUrl) return String(window.hearth.serverUrl).replace(/\/$/, "");
  return "";
}

export function setServerBase(url) {
  const clean = (url || "").trim().replace(/\/$/, "");
  if (clean) localStorage.setItem(SERVER_KEY, clean);
  else localStorage.removeItem(SERVER_KEY);
}

function resolve(path) {
  const base = getServerBase();
  if (!base) return path;
  if (path.startsWith("http")) return path;
  return base + path;
}

export function assetUrl(path) {
  if (!path) return "";
  if (path.startsWith("http") || path.startsWith("data:")) return path;
  return resolve(path);
}

export async function api(path, { method = "GET", body, raw, headers } = {}) {
  const token = getToken();
  const h = { ...(headers || {}) };
  if (token) h.Authorization = `Bearer ${token}`;
  const gate = getGate();
  if (gate) h["X-Hearth-Gate"] = gate;
  if (body !== undefined && !raw) h["Content-Type"] = "application/json";
  const res = await fetch(resolve(path), {
    method,
    headers: h,
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || "Bad response" };
  }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function wsUrl() {
  const gate = getGate();
  const q = gate ? `?g=${encodeURIComponent(gate)}` : "";
  const base = getServerBase();
  if (base) {
    const u = new URL(base);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/ws";
    u.search = "";
    return u.toString() + q;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws${q}`;
}

export async function uploadFile(file, kind = "attachment") {
  const token = getToken();
  const res = await fetch(resolve("/api/upload"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Filename": file.name || "file",
      "X-Kind": kind,
      ...(getGate() ? { "X-Hearth-Gate": getGate() } : {}),
    },
    body: file,
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || "Upload failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
