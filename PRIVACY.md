# Privacy

BloodLink is designed so a curious host, a packet dump, and a third-party CDN all see as little as possible.

## What never leaves your devices

- **No telemetry.** The client does not call home. There are no analytics, crash reporters, or update pings.
- **No Google.** Fonts are system fonts. Voice is **not** WebRTC: audio is relayed by the host so peers never receive IP addresses.
- **No referrers.** Pages send `Referrer-Policy: no-referrer`.
- **Tokens stay out of URLs.** The WebSocket authenticates in the first frame so access logs cannot capture a session.

## What the server can see

The host can see **who is talking to whom**, timestamps, server/channel names, and (for unsealed server channels) message text.

The host **cannot** read **sealed DMs**. Those are ECDH P-256 + AES-GCM on the device. The database stores ciphertext. Server-side search skips sealed messages.

Private keys never leave the browser (`localStorage` key `hearth.e2e.priv`). A new phone or PC cannot decrypt old DMs unless you copy that key.

## Defaults

| Setting | Default |
| --- | --- |
| New accounts | Invite-only after the first user |
| Online status | Hidden |
| Typing indicators | Off |
| Who can DM you | Friends only |
| Email | Not collected |
| Sessions | Expire after 7 days (`HEARTH_SESSION_DAYS`) |
| CORS | Same-origin + localhost only |

## Your controls (User Settings → Privacy)

- Show / hide online status
- Typing indicators
- DMs: friends / anyone / nobody
- Burn sealed DMs after N hours
- Delete account (scrubs your message text and sessions)

## Operator flags

```
HEARTH_OPEN_SIGNUP=1     # allow registration without an invite
HEARTH_SESSION_DAYS=7    # 0 disables expiry
HEARTH_CORS=https://app.example.com
HEARTH_HOST=127.0.0.1    # listen only on localhost
```

## Hidden from strangers

Internet visitors without the secret join link get a blank **404**. Search engines are told not to index. Login is rate-limited. Invites are long random codes. The public health page no longer lists your URL or user count.

This is **not** unhackable. A stolen join link, a compromised friend device, or a bug can still leak access. Sealed DMs still cannot be read from the server disk.

## Honest limits

- Channel chat in a server is **not** E2E (members of that server, and the host, can read it).
- Metadata (membership, who DMs whom, when) is visible to the host.
- Voice peers on a LAN can see each other’s local IPs. That is how WebRTC connects without a STUN server.
- This is not a warrant canary and not a substitute for Qubes + Tor. It is a self-hosted chat app that refuses to spy on you.
