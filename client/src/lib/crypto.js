/** Client-side E2E: ECDH P-256 + AES-GCM. Private key never leaves this device. */
const PRIV = "hearth.e2e.priv";
const PUB = "hearth.e2e.pub";

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBuf(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

export function isSealed(text) {
  return typeof text === "string" && text.startsWith("e2e:1:");
}

export async function loadOrCreateKeys() {
  const existing = localStorage.getItem(PRIV);
  if (existing) {
    try {
      const privJwk = JSON.parse(existing);
      const pubJwk = JSON.parse(localStorage.getItem(PUB) || "{}");
      const privateKey = await crypto.subtle.importKey(
        "jwk",
        privJwk,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"]
      );
      return { privateKey, pubJwk };
    } catch {
      localStorage.removeItem(PRIV);
    }
  }
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const privJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const pubJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  localStorage.setItem(PRIV, JSON.stringify(privJwk));
  localStorage.setItem(PUB, JSON.stringify(pubJwk));
  return { privateKey: pair.privateKey, pubJwk };
}

export function localPubJwk() {
  try {
    return JSON.parse(localStorage.getItem(PUB) || "null");
  } catch {
    return null;
  }
}

async function sharedKey(privateKey, theirPubJwk) {
  const their = await crypto.subtle.importKey(
    "jwk",
    theirPubJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: their }, privateKey, 256);
  return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function sealText(plaintext, theirPubJwk) {
  const { privateKey } = await loadOrCreateKeys();
  const key = await sharedKey(privateKey, theirPubJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return "e2e:1:" + bufToB64(new TextEncoder().encode(JSON.stringify({ iv: bufToB64(iv), ct: bufToB64(ct) })));
}

export async function openText(sealed) {
  if (!isSealed(sealed)) return sealed;
  try {
    const { privateKey } = await loadOrCreateKeys();
    const payload = JSON.parse(new TextDecoder().decode(b64ToBuf(sealed.slice(6))));
    // Try will use our key + we need their pub — stored next to payload in newer format.
    // v1 stores only iv/ct; derive requires their pub. Support v1b: {iv,ct,pub}
    const their = payload.pub;
    if (!their) return "[sealed message — missing key]";
    const key = await sharedKey(privateKey, their);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(b64ToBuf(payload.iv)) },
      key,
      b64ToBuf(payload.ct)
    );
    return new TextDecoder().decode(pt);
  } catch {
    return "[sealed — cannot decrypt on this device]";
  }
}

export async function sealFor(plaintext, theirPubJwk) {
  const { privateKey, pubJwk } = await loadOrCreateKeys();
  const key = await sharedKey(privateKey, theirPubJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const blob = { iv: bufToB64(iv), ct: bufToB64(ct), pub: pubJwk };
  return "e2e:1:" + bufToB64(new TextEncoder().encode(JSON.stringify(blob)));
}

export function parsePubkey(user) {
  if (!user?.pubkey) return null;
  try {
    return typeof user.pubkey === "string" ? JSON.parse(user.pubkey) : user.pubkey;
  } catch {
    return null;
  }
}
