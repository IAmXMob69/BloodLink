# Contributing to BloodLink

BloodLink is free software. Patches, issues, and design notes are welcome.

## Dev setup (Arch Linux)

```bash
sudo pacman -S nodejs npm git
git clone https://github.com/IAmXMob69/BloodLink.git
cd BloodLink
npm install
npm run dev
```

The API listens on `http://127.0.0.1:3928`. The Vite client is on `http://127.0.0.1:5173` and proxies `/api`, `/uploads`, and `/ws`.

On Windows, install Node.js 22.5+ from nodejs.org, then the same `npm` commands.

## Project layout

- `server/` — Node HTTP + WebSocket + SQLite (no extra database to install)
- `client/` — React UI
- `desktop/` — Electron shell for Linux and Windows
- `assets/` — icon and `.desktop` file

## Rules of the road

- Keep the Discord-like layout. New chrome should feel native to the existing dark UI.
- Do not add telemetry, ads, or closed-source binaries.
- Server changes that affect hosted instances must stay AGPL-3.0-or-later.
- Prefer Node built-ins (`node:sqlite`, `node:crypto`, `node:http`) over new native addons.
- Voice is relayed through the host server (no WebRTC). Do not add P2P that would leak IPs.

## Running tests by hand

1. Register two accounts in two browsers (or one window + one incognito).
2. Create a server, invite the second user, send messages, react, reply, upload an image.
3. Open a voice channel from both clients and confirm audio.
4. Confirm the app still works after `npm run build` + `npm run server`.
