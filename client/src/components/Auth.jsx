import React, { useState } from "react";
import { api, setToken, getServerBase, setServerBase, getGate } from "../lib/api.js";

export default function Auth({ onAuthed }) {
  const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  const invited = Boolean(params.get("invite"));
  const [mode, setMode] = useState(invited ? "go" : "login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState(params.get("invite") || "");
  const [inviteOnly, setInviteOnly] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    getGate();
    api("/api/health")
      .then((h) => setInviteOnly(Boolean(h.invite_only)))
      .catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      setServerBase(getServerBase());
      let data;
      if (invited || mode === "go") {
        try {
          data = await api("/api/login", { method: "POST", body: { username, password } });
        } catch (err) {
          if (err.status === 401) {
            data = await api("/api/register", {
              method: "POST",
              body: { username, password, display_name: username, invite },
            });
          } else throw err;
        }
      } else if (mode === "login") {
        data = await api("/api/login", { method: "POST", body: { username, password } });
      } else {
        data = await api("/api/register", {
          method: "POST",
          body: { username, password, display_name: username, invite },
        });
      }
      setToken(data.token);
      onAuthed(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-brand">
            <img src="/icon.png" alt="" />
            <h1>BloodLink</h1>
          </div>
          <h2>{invited ? "Join the conversation" : mode === "login" ? "Welcome back!" : "Create an account"}</h2>
          <p className="lead">
            {invited
              ? "Type a username and password. If you are new, this creates your account. If you have been here, this logs you in."
              : mode === "login"
                ? "We're so excited to see you again!"
                : "Join this private community."}
          </p>
          {error && <div className="auth-error">{error}</div>}
          <div className="field">
            <label>
              Username <span style={{ color: "#f23f43" }}>*</span>
            </label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </div>
          {!invited && mode === "register" && inviteOnly && (
            <div className="field">
              <label>
                Invite code <span style={{ color: "#f23f43" }}>*</span>
              </label>
              <input value={invite} onChange={(e) => setInvite(e.target.value)} required autoComplete="off" />
            </div>
          )}
          <div className="field">
            <label>
              Password <span style={{ color: "#f23f43" }}>*</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={invited ? "new-password" : mode === "login" ? "current-password" : "new-password"}
              required
            />
          </div>
          {invited && (
            <p className="muted" style={{ fontSize: 13 }}>
              New here? Use at least 10 characters with a letter and a number. You will land in the same community.
            </p>
          )}
          <button className="btn" disabled={busy} type="submit">
            {busy ? "Please wait…" : invited ? "Continue" : mode === "login" ? "Log In" : "Continue"}
          </button>
          {!invited && (
            <div className="auth-switch">
              {mode === "login" ? (
                <>
                  Need an account?{" "}
                  <button type="button" className="btn ghost" onClick={() => setMode("register")}>
                    Register
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button type="button" className="btn ghost" onClick={() => setMode("login")}>
                    Log In
                  </button>
                </>
              )}
            </div>
          )}
        </form>
        <aside className="auth-aside">
          <img src="/icon.png" alt="" width="72" height="72" style={{ borderRadius: 16 }} />
          <h3>{invited ? "Private invite" : "BloodLink"}</h3>
          <p>
            {invited
              ? "Nobody else sees your IP. Direct messages are sealed. This computer is only a client — the host's machine is the server."
              : "Self-hosted community chat. Sealed DMs. No ads."}
          </p>
          <p className="muted" style={{ marginTop: 18, fontSize: 13 }}>
            Want your own community instead? Download the host pack and run it on your PC.
          </p>
          <a
            className="btn secondary"
            style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: 8 }}
            href={`/download/BloodLink-Host.zip${getGate() ? `?g=${encodeURIComponent(getGate())}` : ""}`}
          >
            Host your own BloodLink
          </a>
        </aside>
      </div>
    </div>
  );
}
