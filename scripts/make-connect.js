#!/usr/bin/env node
/** Build a friend-facing Connect pack (no server). */
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = process.env.HEARTH_DATA || join(process.env.HOME || ".", ".local/share/bloodlink");
const pubFile = join(data, "public-url");
const publicUrl = (process.env.HEARTH_PUBLIC_URL || (existsSync(pubFile) ? readFileSync(pubFile, "utf8") : "")).trim().replace(/\/$/, "");
const invite = (process.argv[2] || process.env.HEARTH_INVITE || "").trim();
const gateFile = join(data, "gate");
const gate = (process.env.HEARTH_GATE || (existsSync(gateFile) ? readFileSync(gateFile, "utf8").trim() : "")).trim();
if (!publicUrl) {
  console.error("No public URL. Is bloodlink-tunnel running?");
  process.exit(1);
}
const qs = new URLSearchParams();
if (gate) qs.set("g", gate);
if (invite) qs.set("invite", invite);
const joinUrl = qs.toString() ? `${publicUrl}/?${qs}` : publicUrl;
const getUrl = qs.toString() ? `${publicUrl}/download?${qs}` : `${publicUrl}/download`;
const out = process.argv[3] || join(root, "share", "BloodLink-Connect");
mkdirSync(out, { recursive: true });

const icon = join(root, "assets", "icon.png");
if (existsSync(icon)) copyFileSync(icon, join(out, "icon.png"));

writeFileSync(
  join(out, "join.json"),
  JSON.stringify({ url: publicUrl, invite, gate: gate ? true : false, join: joinUrl, download: getUrl, sealed_dms: true }, null, 2)
);

writeFileSync(
  join(out, "READ-ME-FIRST.txt"),
  `BloodLink Connect
=================

This is the chat app — not a server. You are joining a private BloodLink.

1. Windows:  double-click  BloodLink.bat
   Linux:    ./BloodLink.sh
   Mac:      open BloodLink.command
   Phone:    open this link in Chrome, then menu → Add to Home screen

   Then type a username and password. That is all.

   ${joinUrl}

2. You land in the same community as the person who sent you this.

Privacy
- Direct messages are sealed on your device. The host cannot read them.
- No ads, no analytics, no Google login.
- You choose your own credentials. Nobody else picks your password.

Your PC does not host anything. Close the window when you are done.
`
);

writeFileSync(
  join(out, "BloodLink.bat"),
  `@echo off
set "URL=${joinUrl}"
where msedge >nul 2>&1 && start "" msedge --app="%URL%" && exit /b 0
if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" (
  start "" "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" --app="%URL%" & exit /b 0
)
if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" (
  start "" "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" --app="%URL%" & exit /b 0
)
where chrome >nul 2>&1 && start "" chrome --app="%URL%" && exit /b 0
if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" (
  start "" "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" --app="%URL%" & exit /b 0
)
start "" "%URL%"
`
);

writeFileSync(
  join(out, "BloodLink.sh"),
  `#!/usr/bin/env bash
URL=${JSON.stringify(joinUrl)}
for bin in chromium chromium-browser google-chrome google-chrome-stable brave-browser microsoft-edge; do
  if command -v "$bin" >/dev/null; then
    exec "$bin" --app="$URL"
  fi
done
if command -v firefox >/dev/null; then
  exec firefox --new-window "$URL"
fi
exec xdg-open "$URL"
`
);

writeFileSync(
  join(out, "BloodLink.command"),
  `#!/bin/bash
cd "$(dirname "$0")"
URL=${JSON.stringify(joinUrl)}
open -na "Google Chrome" --args --app="$URL" 2>/dev/null || open "$URL"
`
);

writeFileSync(
  join(out, "BloodLink.url"),
  `[InternetShortcut]\r\nURL=${joinUrl}\r\n`
);

spawnSync("chmod", ["+x", join(out, "BloodLink.sh"), join(out, "BloodLink.command")]);
const zip = join(dirname(out), "BloodLink-Connect.zip");
spawnSync("rm", ["-f", zip]);
const z = spawnSync("zip", ["-qr", zip, "BloodLink-Connect"], { cwd: dirname(out) });
if (z.status !== 0) {
  console.error("zip failed", z.stderr?.toString());
  process.exit(1);
}
console.log(zip);
console.log(joinUrl);
