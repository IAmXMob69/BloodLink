export function connectPage({ publicUrl, invite, gate }) {
  const q = new URLSearchParams();
  if (gate) q.set("g", gate);
  if (invite) q.set("invite", invite);
  const qs = q.toString();
  const join = qs ? `${publicUrl || ""}/?${qs}` : publicUrl || "/";
  const dl = qs ? `/download/BloodLink-Connect.zip?${qs}` : "/download/BloodLink-Connect.zip";
  const hostQs = gate ? `g=${encodeURIComponent(gate)}` : "";
  const hostDl = hostQs ? `/download/BloodLink-Host.zip?${hostQs}` : "/download/BloodLink-Host.zip";
  const login = qs ? `${publicUrl || ""}/?${qs}` : publicUrl || "/";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="referrer" content="no-referrer"/>
  <meta name="robots" content="noindex,nofollow"/>
  <title>Join this BloodLink</title>
  <style>
    :root { color-scheme: dark; }
    body { margin:0; font-family: system-ui, sans-serif; background:#0f1012; color:#efe8df;
      min-height:100vh; display:grid; place-items:center; padding:24px; }
    .card { max-width:560px; width:100%; background:#313338; border-radius:12px; padding:28px;
      box-shadow: 0 12px 40px #0008; }
    img { width:64px; height:64px; border-radius:14px; }
    h1 { margin:12px 0 6px; font-size:28px; }
    h2 { margin:22px 0 8px; font-size:16px; color:#f4a261; }
    p, li { color:#b9bbbe; line-height:1.45; }
    ol { padding-left:1.2em; }
    .btn { display:block; text-align:center; background:#e85d04; color:#fff; text-decoration:none;
      padding:12px 16px; border-radius:6px; font-weight:600; margin:10px 0 0; }
    .btn.sec { background:#2b2d31; color:#f2f3f5; }
    .ok { color:#3ecf8e; font-size:14px; }
    .split { margin-top:28px; padding-top:22px; border-top:1px solid #3f4147; }
    .host { background:#1e1f22; border-radius:10px; padding:16px 16px 18px; margin-top:10px; }
    .host p { margin:8px 0 0; }
  </style>
</head>
<body>
  <div class="card">
    <img src="/icon.png" alt=""/>
    <h1>You were invited to BloodLink</h1>
    <p>This is a private community on the host’s computer. You only run a client.</p>
    <p class="ok">Type a username and password. That is all. You do not need their Wi‑Fi.</p>

    <a class="btn" href="${join}">Open BloodLink — username &amp; password</a>
    <a class="btn sec" href="${dl}">Download the app (Windows / Linux / Mac)</a>

    <h2>How to use the download</h2>
    <ol>
      <li>Unzip <b>BloodLink-Connect.zip</b>.</li>
      <li>Windows: double-click <b>BloodLink.bat</b>. Linux: <b>./BloodLink.sh</b>. Mac: <b>BloodLink.command</b>.</li>
      <li>Enter a username and a password (10+ characters, letter + number) and hit Continue.</li>
      <li>First time creates your account. Next time the same names log you in.</li>
    </ol>
    <p>Phone: tap “Open BloodLink”, then in Chrome use <b>Add to Home screen</b>.</p>

    <h2>Privacy</h2>
    <p>Direct messages are sealed on your device — the host cannot read them. Voice goes through the host PC, so other people never see your IP. No ads. No trackers. Keep this link private.</p>

    <h2>Already have an account?</h2>
    <a class="btn sec" href="${login}">Log in with the same username and password</a>

    <div class="split">
      <h2>Want your own BloodLink?</h2>
      <div class="host">
        <p>Download the <b>host pack</b> and run it on your computer. That starts a new community that you control — it does not join this one.</p>
        <a class="btn" href="${hostDl}">Download BloodLink to host your own server</a>
        <p>Unzip <b>BloodLink-Host.zip</b>. Linux: <b>./install-linux.sh</b>. Windows: <b>install-windows.bat</b>. Need Node.js 22+ from nodejs.org. First account you create is the host. Then use Invite People for your friends.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}
