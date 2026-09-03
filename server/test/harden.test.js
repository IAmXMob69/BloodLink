import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp, isPublicHop, corsAllows, gateOk, takeTurn } from "../src/harden.js";
import { hashSessionToken, token, validUsername, validPassword } from "../src/util.js";
import { sniffKind, attachmentAllowed } from "../src/sniff.js";

function req(headers = {}, remoteAddress = "127.0.0.1") {
  return { headers, socket: { remoteAddress } };
}

test("clientIp ignores spoofed XFF from the LAN", () => {
  const r = req({ "x-forwarded-for": "1.2.3.4" }, "192.168.1.50");
  assert.equal(clientIp(r), "192.168.1.50");
  assert.equal(isPublicHop(r), false);
});

test("clientIp trusts XFF only from loopback", () => {
  const r = req({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }, "127.0.0.1");
  assert.equal(clientIp(r), "9.9.9.9");
  assert.equal(isPublicHop(r), true);
});

test("corsAllows localhost and exact public URL only", () => {
  assert.equal(corsAllows("http://127.0.0.1:3928"), true);
  assert.equal(corsAllows("https://evil.trycloudflare.com"), false);
  assert.equal(
    corsAllows("https://abc.trycloudflare.com", { publicUrl: "https://abc.trycloudflare.com" }),
    true
  );
  assert.equal(
    corsAllows("https://abc.trycloudflare.com", { publicUrl: "https://other.trycloudflare.com" }),
    false
  );
  assert.equal(corsAllows("https://app.example", { extra: ["https://app.example"] }), true);
});

test("gateOk is length-safe", () => {
  const g = "a".repeat(32);
  assert.equal(gateOk(g, g), true);
  assert.equal(gateOk("b".repeat(32), g), false);
  assert.equal(gateOk("short", g), false);
  assert.equal(gateOk("", g), false);
});

test("takeTurn locks after max hits", () => {
  const key = "test:" + Date.now();
  assert.equal(takeTurn(key, { max: 2, windowMs: 60_000, lockMs: 1000 }).ok, true);
  assert.equal(takeTurn(key, { max: 2, windowMs: 60_000, lockMs: 1000 }).ok, true);
  assert.equal(takeTurn(key, { max: 2, windowMs: 60_000, lockMs: 1000 }).ok, false);
});

test("hashSessionToken is stable and prefixed", () => {
  const t = token();
  const a = hashSessionToken(t);
  const b = hashSessionToken(t);
  assert.equal(a, b);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(a, t);
});

test("validUsername and validPassword", () => {
  assert.equal(validUsername("ok_user"), true);
  assert.equal(validUsername("x"), false);
  assert.equal(validPassword("abcdefghij1", "bob"), true);
  assert.equal(validPassword("short1Aa", "bob"), false);
  assert.equal(validPassword("bobpassword1", "bob"), false);
});

test("sniffKind matches common magics", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const gif = Buffer.from("GIF89a........");
  const html = Buffer.from("<!DOCTYPE html><html><script>alert(1)</script></html>");
  const pdf = Buffer.from("%PDF-1.4 extra");
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  assert.equal(sniffKind(png), "png");
  assert.equal(sniffKind(jpeg), "jpeg");
  assert.equal(sniffKind(gif), "gif");
  assert.equal(sniffKind(html), "txt");
  assert.equal(sniffKind(pdf), "pdf");
  assert.equal(sniffKind(zip), "zip");
  assert.equal(attachmentAllowed(".png", png), true);
  assert.equal(attachmentAllowed(".png", html), false);
  assert.equal(attachmentAllowed(".txt", html), true);
  assert.equal(attachmentAllowed(".pdf", png), false);
});
