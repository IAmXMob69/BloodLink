# Security

See [HOW-IT-WORKS.md](HOW-IT-WORKS.md) for how hosts and friends use BloodLink.
See [PRIVACY.md](PRIVACY.md) for what the host can and cannot see.

Please report vulnerabilities privately if you can. Open an issue only if there is no other channel.

BloodLink is a self-hosted chat server. Treat an instance like email:

- Bind to LAN or put it behind TLS (Caddy, nginx, or a reverse proxy) before exposing it to the internet.
- Use long passwords. There is no third-party auth yet.
- Uploads are limited to common file types and 12 MB. Do not relax that without a virus-scanning plan.
- The default SQLite file lives in `server/data/bloodlink.db` (or the Electron user-data directory). Back it up; it is the whole server.

Known limits in 0.1:

- Voice uses a public STUN server. There is no TURN, so some NATs will fail.
- There is no rate-limit across restarts (in-memory only on a future pass).
- Sessions are random tokens stored in SQLite; they do not expire automatically.
