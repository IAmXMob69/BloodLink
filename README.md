# Hearth

Open-source community communication for **Linux** and **Windows**. Servers, text channels, voice channels, DMs, friends, reactions, files — laid out like Discord, owned by you.

Hearth is not affiliated with Discord. It is a from-scratch AGPL app you can run on a single Arch box, a LAN, or a VPS.

![Hearth icon](assets/icon.png)

## Features

- **Servers** with categories, text channels, and voice channels
- **Realtime chat** over WebSockets (edit, delete, reply, pin, search)
- **Reactions**, typing indicators, unread-aware history
- **Friends** and **direct messages**
- **Voice** via WebRTC (mute, deafen, screen share)
- **Invites** so people can join your community
- **Self-hosted** SQLite backend — no cloud account
- **Desktop app** (Electron) plus a browser client
- **Instance URL** so one desktop app can join any Hearth server

## Requirements

- **Node.js 22.5+** (uses built-in `node:sqlite`)
- Linux (tested on **Arch Linux + Xfce**) or Windows 10/11
- A microphone if you want voice

### Arch Linux

```bash
sudo pacman -S nodejs npm git
```

Optional, for the packaged desktop app later:

```bash
sudo pacman -S electron
```

### Windows

Install Node.js LTS (22+) from [nodejs.org](https://nodejs.org/), then use the same `npm` commands in PowerShell or Git Bash.

## Quick start

```bash
git clone https://github.com/IAmXMob69/hearth.git
cd hearth
npm install
npm run dev
```

Then open **http://127.0.0.1:5173** in Firefox or Chromium.

- Register an account. The first account gets a starter server and an invite code.
- Create a second account (private window) and join with that invite to see live chat.
- Your tag looks like `blaine#4821` — that is how friends add you.

### Desktop window (this machine)

With the dev server already running:

```bash
npm run desktop:dev
```

Or build the UI and open the Electron shell against the production server:

```bash
npm run desktop
```

### Production (one process)

```bash
npm run build
npm run server
```

The server serves the API, WebSocket endpoint, uploads, and the built client on **http://0.0.0.0:3928**.

On Xfce you can bookmark that URL, or create a launcher:

```
Name: Hearth
Command: firefox --new-window http://127.0.0.1:3928
Icon: /path/to/hearth/assets/icon.png
```

## Join from another computer

1. On the host, note its LAN IP (`ip a`).
2. Open port `3928` on the firewall if you use one (`sudo ufw allow 3928/tcp` or your nftables equivalent).
3. On the other machine, open `http://HOST_IP:3928` or, in the Hearth login screen, click **Use a different instance** and paste that URL.

Put Caddy or nginx with TLS in front before you expose this to the public internet.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `HEARTH_PORT` | `3928` | HTTP + WebSocket port |
| `HEARTH_HOST` | `0.0.0.0` | Bind address |
| `HEARTH_DATA` | `server/data` | SQLite + uploads |
| `HEARTH_CLIENT` | `client/dist` | Built UI to serve |
| `HEARTH_SOURCE` | GitHub URL | AGPL source link |

Database file: `server/data/hearth.db`.

## Packaging

```bash
npm run pack:linux    # AppImage under desktop/release
npm run pack:win      # NSIS installer + portable exe (run on Windows)
```

A sample Xfce/FreeDesktop file is in `assets/hearth.desktop`.

## Project layout

```
hearth/
  server/     Node HTTP + WebSocket + SQLite
  client/     React UI (Discord-like layout)
  desktop/    Electron wrapper
  assets/     icon and .desktop file
```

## License

[GNU Affero General Public License v3.0 or later](LICENSE).

If you run a modified Hearth server that people can log into, AGPL requires you to offer them the source of that modified version. The in-app **User Settings → Advanced** page links to the source.

## Publish the source (GitHub)

The project is already a git repo. To put it on GitHub as a public repository:

```bash
# in a browser: github.com/new  → name it hearth → Public
cd ~/Projects/hearth
git remote add origin git@github.com:IAmXMob69/hearth.git
git branch -M main
git push -u origin main
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Design principle: stay familiar to Discord users, stay independent of Discord's brand, stay self-hostable.
