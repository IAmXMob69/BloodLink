# BloodLink

Open-source Discord-style chat you host on **your own computer**. Friends download a small client, pick a username and password, and join. Not affiliated with Discord.

See **[HOW-IT-WORKS.md](HOW-IT-WORKS.md)** first. Privacy details: **[PRIVACY.md](PRIVACY.md)**.

![BloodLink icon](assets/icon.png)

## How people use it

| Role | What they run | What they do |
| --- | --- | --- |
| **Host** | This repo + `bloodlink-server` on one PC | Keep the PC on. Click **Invite People**. Send the secret link. |
| **Friends** | Browser, `BloodLink-Connect.zip`, or phone home-screen | Open the link. Type username + password. Chat. |

Friends never install the server. They never need the host’s Wi‑Fi.

## Features

- Servers, categories, text channels, voice (relayed by the host — no peer IPs)
- Realtime chat: edit, delete, reply, pin, search, reactions, uploads
- Friends and sealed DMs (the host cannot read DM plaintext)
- Invite People button → secret link (`g=` gate + invite)
- Desktop (Electron / browser app window) and Android (PWA or `android/` Studio project)
- No ads, no analytics, no Google fonts or STUN

## Host (this machine)

On Arch Linux with the services already enabled:

```bash
systemctl --user status bloodlink-server bloodlink-tunnel
# app on this PC:
xdg-open http://127.0.0.1:3928
```

From a clean tree:

```bash
sudo pacman -S nodejs npm
cd ~/Projects/BloodLink
npm install
npm run build
# then enable the systemd user units if you use them
```

Data lives in `~/.local/share/bloodlink/` (database, uploads, gate, tunnel URL).

**Invite:** open a server → orange **Invite People** → Copy link.

The public URL is a **free Cloudflare quick tunnel**. It can change after a reboot. Copy a fresh link if old ones die. The host PC must be awake.

## Friends

Do **not** run `install-linux.sh` / `install-windows.bat` unless you want a *new* empty community.

1. Open the secret link or unzip `BloodLink-Connect.zip`
2. `BloodLink.bat` (Windows) or `./BloodLink.sh` (Linux)
3. Username + password → Continue

## Developers

```bash
npm install
npm run dev          # API :3928 + Vite :5173
npm run desktop:dev  # Electron against Vite
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `HEARTH_PORT` / `PORT` | `3928` | Listen port |
| `HEARTH_HOST` | `0.0.0.0` | Bind address |
| `HEARTH_DATA` | `server/data` or `~/.local/share/bloodlink` | SQLite + gate + uploads |
| `HEARTH_CLIENT` | `client/dist` | Built UI |
| `HEARTH_OPEN_SIGNUP` | unset (invite-only after first user) | Set `1` to allow open registration |
| `HEARTH_SESSION_DAYS` | `7` | Session lifetime |
| `HEARTH_GATE` | file `…/gate` | Secret for public access |
| `HEARTH_MSG_GAP_MS` | `2000` | Minimum ms between chat messages (anti-bot) |

```
server/    Node HTTP + WebSocket + SQLite
client/    React UI
desktop/   Electron (host window, or --connect=URL for friends)
android/   Android Studio WebView client
scripts/   tunnel, Connect zip, desktop launcher
```

## License

[GNU Affero GPL v3 or later](LICENSE). A running modified server must offer its source (**User Settings → Advanced**).
