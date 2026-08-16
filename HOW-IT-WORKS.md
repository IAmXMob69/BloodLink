# How BloodLink works

Read this if you were invited, or if you host the community.

## The short version

- **One computer is the server.** That is the host’s PC. It must be on for anyone to chat.
- **Everyone else only uses a client.** They never install a server — unless they tap **Host your own BloodLink** on the invite page and run that pack on their PC.
- Friends get a **secret link** (or `BloodLink-Connect.zip`). They open it, type a **username and password**, and they are in.
- They do **not** need the host’s Wi‑Fi. They do **not** type a server address or invite code.
- **Do not post the secret link in public.** It is a house key.

## If you were invited (friends)

1. Open the link you were sent, **or** unzip `BloodLink-Connect.zip`.
2. Windows: double-click `BloodLink.bat`.  
   Linux: run `./BloodLink.sh`.  
   Mac: open `BloodLink.command`.  
   Phone: open the link in Chrome → menu → **Add to Home screen**.
3. Type any username and a password (at least 10 characters, with a letter and a number).
4. Click **Continue**.
   - First time: that **creates** your account and puts you in the host’s server.
   - Next times: that **logs you in**.
5. You will see servers on the left, channels in the middle, members on the right.

If you want **your own** community instead of this one, the same invite page has **Host your own BloodLink**. That downloads `BloodLink-Host.zip`. Unzip it and run `install-linux.sh` or `install-windows.bat` on your computer (Node.js 22+). That starts a new server. It does not join this one.

### What you can do

- Click a server (the circle). Click **#general** to chat.
- Stickers: the square-smile button next to the message box. Pick a pack (Droplet, Punch, or one you add), tap a sticker, it sends big like Telegram. Make your own pack in **User Settings → Stickers**.
- Direct messages: Home (house icon) → **Add Friend** with their `name#1234`, or open a profile.
- Voice: click a voice channel. Audio goes through the host’s computer. Other people **never** get your IP address.
- The gear next to your name is **User Settings** (profile, privacy, log out).
- **Invite People** (orange button under the server name) is for the host / members to copy a new secret link.

### Privacy (friends)

- Your password is yours. Nobody else chooses it. Email is not required.
- Direct messages are **sealed** on your device. The host cannot read them from the server.
- Voice is relayed by the host PC. Peers do not see each other’s IPs.
- There are no ads, no analytics, and no Google login.
- Channel chat in a server (`#general`) **can** be read by people in that server and by whoever holds the host PC.

## If you host (this machine)

Your Arch PC runs two services:

- `bloodlink-server` — the chat database and website (`http://127.0.0.1:3928`)
- `bloodlink-tunnel` — a **free** Cloudflare tunnel so friends can reach you from the internet

Check them:

```bash
systemctl --user status bloodlink-server bloodlink-tunnel
```

Open the app locally: **http://127.0.0.1:3928** or the BloodLink desktop launcher.

### Invite someone

1. Click your server (not the house / Home icon).
2. Click the orange **Invite People** button (or **Invite** in the top bar).
3. **Copy link** and send it in a private message.
4. Or send `BloodLink-Connect.zip` from the Desktop — rebuild it after the tunnel address changes.

The link looks like:

`https://something.trycloudflare.com/download?g=…&invite=…`

- `g=` is a secret gate. Without it the public site is a blank 404.
- `invite=` drops them into your server after they pick a password.

### Tunnel notes

The tunnel is free. It has no bill. If this PC restarts, the `something.trycloudflare.com` name **can change**. Old links then fail until you copy a new one from **Invite People**.

If this PC is off or asleep, nobody can connect.

## What BloodLink is not

- Not Discord. Not affiliated with Discord.
- Not a cloud host. The community lives on the host’s computer.
- Not unhackable. A leaked link or a stolen phone still gets someone in.

## License

GNU Affero GPL v3. Source: see **User Settings → Advanced** in the app, or `LICENSE` in this folder.
