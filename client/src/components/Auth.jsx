import React, { useState } from "react";
import { api, setToken, getServerBase, setServerBase } from "../lib/api.js";

export default function Auth({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [display, setDisplay] = useState("");
  const [server, setServer] = useState(getServerBase());
  const [showServer, setShowServer] = useState(Boolean(getServerBase()));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      setServerBase(server);
      const path = mode === "login" ? "/api/login" : "/api/register";
      const body =
        mode === "login"
          ? { username, password }
          : { username, password, email, display_name: display || username };
      const data = await api(path, { method: "POST", body });
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
            <h1>Hearth</h1>
          </div>
          <h2>{mode === "login" ? "Welcome back!" : "Create an account"}</h2>
          <p className="lead">
            {mode === "login"
              ? "We're so excited to see you again!"
              : "Join a self-hosted community, or start your own."}
          </p>
          {error && <div className="auth-error">{error}</div>}
          {mode === "register" && (
            <div className="field">
              <label>Display name</label>
              <input value={display} onChange={(e) => setDisplay(e.target.value)} maxLength={32} />
            </div>
          )}
          <div className="field">
            <label>
              {mode === "login" ? "Username or email" : "Username"}{" "}
              <span style={{ color: "#f23f43" }}>*</span>
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          {mode === "register" && (
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
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
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </div>
          <button
            type="button"
            className="btn ghost"
            style={{ marginBottom: 12, fontSize: 13 }}
            onClick={() => setShowServer((v) => !v)}
          >
            {showServer ? "Hide instance URL" : "Use a different instance"}
          </button>
          {showServer && (
            <div className="field">
              <label>Instance URL</label>
              <input
                placeholder="http://127.0.0.1:3928  (blank = this app)"
                value={server}
                onChange={(e) => setServer(e.target.value)}
              />
            </div>
          )}
          <button className="btn" disabled={busy} type="submit">
            {busy ? "Please wait…" : mode === "login" ? "Log In" : "Continue"}
          </button>
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
        </form>
        <aside className="auth-aside">
          <img src="/icon.png" alt="" width="72" height="72" style={{ borderRadius: 16 }} />
          <h3>Your own Discord-style space.</h3>
          <p>
            Servers, text and voice channels, DMs, friends, reactions, and file sharing — self-hosted
            and AGPL licensed. Run it on this machine or join a friend's instance.
          </p>
        </aside>
      </div>
    </div>
  );
}
