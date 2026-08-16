import React, { useState } from "react";
import { api, uploadFile, setServerBase, getServerBase, setToken } from "../lib/api.js";
import { getState, setState, useStore } from "../lib/store.js";
import { displayName, tagName } from "../lib/format.jsx";
import Avatar from "./Avatar.jsx";
import { StickersSettings } from "./Stickers.jsx";

export function ModalShell({ children, onClose, wide }) {
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function CreateServer() {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  async function go(e) {
    e.preventDefault();
    try {
      await api("/api/servers", { method: "POST", body: { name } });
      setState({ modal: null });
    } catch (ex) {
      setErr(ex.message);
    }
  }
  return (
    <ModalShell onClose={() => setState({ modal: null })}>
      <h3>Create a server</h3>
      <form onSubmit={go}>
        <div className="body">
          <p className="muted">Your server is where you and your friends hang out. Make yours and start talking.</p>
          {err && <div className="auth-error">{err}</div>}
          <div className="field">
            <label>Server name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
        </div>
        <div className="foot">
          <button type="button" className="btn ghost" onClick={() => setState({ modal: { type: "join" } })}>
            Join a server
          </button>
          <button className="btn" type="submit">Create</button>
        </div>
      </form>
    </ModalShell>
  );
}

export function JoinServer() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  async function go(e) {
    e.preventDefault();
    try {
      const data = await api(`/api/invites/${encodeURIComponent(code.trim())}/join`, { method: "POST", body: {} });
      setState({
        modal: null,
        active: {
          kind: "server",
          serverId: data.server.id,
          channelId: data.server.channels?.find((c) => c.type === "text")?.id || null,
          tab: "online",
        },
      });
    } catch (ex) {
      setErr(ex.message);
    }
  }
  return (
    <ModalShell onClose={() => setState({ modal: null })}>
      <h3>Join a server</h3>
      <form onSubmit={go}>
        <div className="body">
          <p className="muted">Enter an invite code you received from a friend.</p>
          {err && <div className="auth-error">{err}</div>}
          <div className="field">
            <label>Invite code</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="aB3dE7gH" autoFocus required />
          </div>
        </div>
        <div className="foot">
          <button type="button" className="btn secondary" onClick={() => setState({ modal: { type: "create-server" } })}>
            Back
          </button>
          <button className="btn" type="submit">Join server</button>
        </div>
      </form>
    </ModalShell>
  );
}

export function InviteModal({ server }) {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [pub, setPub] = useState(getState().publicUrl || "");
  React.useEffect(() => {
    api(`/api/servers/${server.id}/invites`, { method: "POST", body: {} })
      .then((d) => setCode(d.invite.code))
      .catch(() => {});
    api("/api/runtime")
      .then((h) => {
        if (h.public_url) {
          setPub(h.public_url);
          setState({ publicUrl: h.public_url });
        }
      })
      .catch(() => {});
  }, [server.id]);
  const gate =
    getState().gate ||
    (typeof localStorage !== "undefined" && localStorage.getItem("hearth.gate")) ||
    "";
  const q = new URLSearchParams();
  if (gate) q.set("g", gate);
  if (code) q.set("invite", code);
  const qs = q.toString();
  const link = pub && qs ? `${pub.replace(/\/$/, "")}/?${qs}` : "";
  const getApp = pub && qs ? `${pub.replace(/\/$/, "")}/download?${qs}` : "";
  function copy() {
    navigator.clipboard?.writeText(getApp || link || code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <ModalShell onClose={() => setState({ modal: null })}>
      <h3>Invite friends to {server.name}</h3>
      <div className="body">
        <p className="muted">
          Send the first link. Friends open it (or download the app from that page), type a username and
          password, and they are in. They do not need your Wi‑Fi, a server address, or this code.
          That page also has a download if they want to host their own BloodLink. Keep the link private.
        </p>
        {getApp && (
          <p className="invite-code" style={{ fontSize: 14, wordBreak: "break-all", marginBottom: 8 }}>
            {getApp}
          </p>
        )}
        <div className="invite-code" style={{ fontSize: 14, wordBreak: "break-all" }}>
          {link || (code ? `Invite code ${code} (public link still coming up…)` : "…")}
        </div>
        {code && (
          <p className="muted" style={{ marginTop: 10 }}>
            Code only: <b>{code}</b>
          </p>
        )}
      </div>
      <div className="foot">
        <button className="btn secondary" onClick={() => setState({ modal: null })}>Done</button>
        <button className="btn" onClick={copy} disabled={!code}>{copied ? "Copied" : "Copy link"}</button>
      </div>
    </ModalShell>
  );
}

export function ServerSettings({ server }) {
  const owner = Boolean(server.is_owner);
  const [name, setName] = useState(server.name || "");
  const [description, setDescription] = useState(server.description || "");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (!owner) {
    return (
      <ModalShell onClose={() => setState({ modal: null })}>
        <h3>Server settings</h3>
        <div className="body">
          <p className="muted">Only the host can change this server.</p>
        </div>
        <div className="foot">
          <button type="button" className="btn" onClick={() => setState({ modal: null })}>
            Close
          </button>
        </div>
      </ModalShell>
    );
  }

  async function save(e) {
    e.preventDefault();
    setErr("");
    setMsg("");
    setBusy(true);
    try {
      await api(`/api/servers/${server.id}`, {
        method: "PATCH",
        body: { name: name.trim(), description },
      });
      setMsg("Saved.");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (owner) {
      if (!confirm(`Delete ${server.name}? This cannot be undone.`)) return;
      await api(`/api/servers/${server.id}`, { method: "DELETE" });
    } else {
      if (!confirm(`Leave ${server.name}?`)) return;
      await api(`/api/servers/${server.id}/leave`, { method: "POST", body: {} });
    }
    setState({ modal: null });
  }

  return (
    <ModalShell wide onClose={() => setState({ modal: null })}>
      <h3>Server settings</h3>
      <form onSubmit={save}>
        <div className="body">
          {err && <div className="auth-error">{err}</div>}
          {msg && <div className="settings-ok">{msg}</div>}
          <div className="field">
            <label>Server name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={!owner} required minLength={2} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!owner} maxLength={300} />
          </div>
          <p className="muted">Owner can rename the server. Anyone can invite friends or leave.</p>
        </div>
        <div className="foot" style={{ justifyContent: "space-between" }}>
          <button type="button" className="btn danger" onClick={remove}>
            {owner ? "Delete server" : "Leave server"}
          </button>
          <span style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setState({ modal: { type: "invite" } })}
            >
              Invite People
            </button>
            <button type="button" className="btn secondary" onClick={() => setState({ modal: null })}>
              Close
            </button>
            {owner && (
              <button className="btn" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            )}
          </span>
        </div>
      </form>
    </ModalShell>
  );
}

export function CreateChannel({ server, type = "text" }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState(type);
  const [err, setErr] = useState("");
  async function go(e) {
    e.preventDefault();
    try {
      await api(`/api/servers/${server.id}/channels`, { method: "POST", body: { name, type: kind } });
      setState({ modal: null });
    } catch (ex) {
      setErr(ex.message);
    }
  }
  return (
    <ModalShell onClose={() => setState({ modal: null })}>
      <h3>Create channel</h3>
      <form onSubmit={go}>
        <div className="body">
          {err && <div className="auth-error">{err}</div>}
          <div className="field">
            <label>Channel type</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="text">Text</option>
              <option value="voice">Voice</option>
              <option value="category">Category</option>
            </select>
          </div>
          <div className="field">
            <label>Channel name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
        </div>
        <div className="foot">
          <button type="button" className="btn secondary" onClick={() => setState({ modal: null })}>Cancel</button>
          <button className="btn" type="submit">Create channel</button>
        </div>
      </form>
    </ModalShell>
  );
}

export function Settings() {
  const tab = useStore((s) => s.settingsTab);
  const me = useStore((s) => s.me);
  const membersOpen = useStore((s) => s.membersOpen);
  const sourceUrl = useStore((s) => s.sourceUrl);
  const [display, setDisplay] = useState(me?.display_name || "");
  const [bio, setBio] = useState(me?.bio || "");
  const [custom, setCustom] = useState(me?.custom_status || "");
  const [instance, setInstance] = useState(getServerBase());
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [mics, setMics] = useState([]);
  const [micId, setMicId] = useState(localStorage.getItem("hearth.mic") || "");
  const [compact, setCompact] = useState(document.body.classList.contains("compact"));

  React.useEffect(() => {
    setDisplay(me?.display_name || "");
    setBio(me?.bio || "");
    setCustom(me?.custom_status || "");
  }, [me?.display_name, me?.bio, me?.custom_status]);

  React.useEffect(() => {
    if (tab !== "voice") return;
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((devs) => setMics(devs.filter((d) => d.kind === "audioinput")))
      .catch(() => {});
  }, [tab]);

  async function saveAccount(e) {
    e?.preventDefault?.();
    setErr("");
    setMsg("");
    setBusy(true);
    try {
      await api("/api/me", {
        method: "PATCH",
        body: { display_name: display.trim() || me.username, bio, custom_status: custom },
      });
      setMsg("Saved.");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function onAvatar(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr("");
    setMsg("");
    try {
      await uploadFile(file, "avatar");
      setMsg("Avatar updated.");
    } catch (ex) {
      setErr(ex.message);
    }
  }

  async function setStatus(status) {
    setErr("");
    try {
      await api("/api/me", { method: "PATCH", body: { status } });
      setMsg(`Status set to ${status}.`);
    } catch (ex) {
      setErr(ex.message);
    }
  }

  function close() {
    setState({ settingsOpen: false });
  }

  const tabs = [
    ["account", "My Account"],
    ["profile", "Profile"],
    ["privacy", "Privacy"],
    ["appearance", "Appearance"],
    ["stickers", "Stickers"],
    ["voice", "Voice & Video"],
    ["advanced", "Advanced"],
  ];
  const privacy = me?.privacy || { presence: false, typing: false, dms: "friends", vanish_hours: 0 };

  async function savePrivacy(patch) {
    setErr("");
    try {
      await api("/api/me", { method: "PATCH", body: { privacy: { ...privacy, ...patch } } });
      setMsg("Privacy saved.");
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <div className="settings-back" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="settings">
        <nav>
          <div className="lab">User settings</div>
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "on" : ""}
              onClick={() => {
                setMsg("");
                setErr("");
                setState({ settingsTab: id });
              }}
            >
              {label}
            </button>
          ))}
          <div className="lab">Actions</div>
          <button
            type="button"
            className="danger"
            onClick={() => {
              setToken("");
              setState({ settingsOpen: false, me: null, token: "" });
              location.reload();
            }}
          >
            Log Out
          </button>
        </nav>
        <div className="pane">
          <button type="button" className="settings-close" onClick={close} title="Esc">
            ✕
          </button>

          {err && <div className="auth-error">{err}</div>}
          {msg && <div className="settings-ok">{msg}</div>}

          {tab === "account" && (
            <>
              <h3>My Account</h3>
              <div className="settings-hero">
                <Avatar user={me} size="lg" />
                <div>
                  <div className="strong">{displayName(me)}</div>
                  <div className="muted">{tagName(me)}</div>
                  <label className="btn sm" style={{ display: "inline-block", marginTop: 8 }}>
                    Change avatar
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onAvatar} />
                  </label>
                </div>
              </div>
              <form onSubmit={saveAccount}>
                <div className="field">
                  <label>Display name</label>
                  <input value={display} onChange={(e) => setDisplay(e.target.value)} maxLength={32} />
                </div>
                <div className="field">
                  <label>Username</label>
                  <input value={tagName(me)} disabled />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input value={me?.email || "Not set"} disabled />
                </div>
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save changes"}
                </button>
              </form>
            </>
          )}

          {tab === "profile" && (
            <>
              <h3>Profile</h3>
              <div className="field">
                <label>Custom status</label>
                <input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  maxLength={128}
                  placeholder="What are you up to?"
                />
              </div>
              <div className="field">
                <label>About me</label>
                <textarea rows={4} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={190} />
              </div>
              <div className="field">
                <label>Status</label>
                <div className="status-row">
                  {["online", "idle", "dnd", "invisible"].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`btn sm ${me?.status === s ? "" : "secondary"}`}
                      onClick={() => setStatus(s)}
                    >
                      <span className={`dot st-${s}`} style={{ position: "static", border: 0, width: 10, height: 10 }} />
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" className="btn" onClick={saveAccount} disabled={busy}>
                {busy ? "Saving…" : "Save profile"}
              </button>
            </>
          )}

          {tab === "privacy" && (
            <>
              <h3>Privacy</h3>
              <p className="muted">
                BloodLink is built so the host sees as little as possible. Direct messages are sealed on your device.
                There is no analytics, no crash phone-home, and no third-party fonts or STUN servers.
              </p>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={privacy.presence}
                  onChange={(e) => savePrivacy({ presence: e.target.checked })}
                />
                Show when I am online
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={privacy.typing}
                  onChange={(e) => savePrivacy({ typing: e.target.checked })}
                />
                Send typing indicators
              </label>
              <div className="field">
                <label>Who can direct-message me</label>
                <select value={privacy.dms} onChange={(e) => savePrivacy({ dms: e.target.value })}>
                  <option value="friends">Friends only</option>
                  <option value="anyone">Anyone on this server</option>
                  <option value="nobody">Nobody</option>
                </select>
              </div>
              <div className="field">
                <label>Burn sealed DMs after (hours, 0 = keep)</label>
                <input
                  type="number"
                  min="0"
                  max="8760"
                  value={privacy.vanish_hours || 0}
                  onChange={(e) => savePrivacy({ vanish_hours: Number(e.target.value) || 0 })}
                />
              </div>
              <p className="muted">
                Sealed DMs are encrypted before they leave this device. The database stores ciphertext.
                Search cannot see inside them. A new device cannot read old DMs unless you copy this browser&apos;s
                BloodLink keys.
              </p>
              <button
                type="button"
                className="btn danger"
                onClick={async () => {
                  if (!confirm("Permanently delete your account, sessions, and the text of messages you wrote?")) return;
                  try {
                    await api("/api/me", { method: "DELETE" });
                    setToken("");
                    location.reload();
                  } catch (ex) {
                    setErr(ex.message);
                  }
                }}
              >
                Delete my account
              </button>
            </>
          )}

          {tab === "appearance" && (
            <>
              <h3>Appearance</h3>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={membersOpen}
                  onChange={(e) => setState({ membersOpen: e.target.checked })}
                />
                Show member list
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={compact}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setCompact(on);
                    document.body.classList.toggle("compact", on);
                    localStorage.setItem("hearth.compact", on ? "1" : "0");
                  }}
                />
                Compact mode
              </label>
              <p className="muted">BloodLink uses a dark theme built for long conversations.</p>
            </>
          )}

          {tab === "stickers" && <StickersSettings />}

          {tab === "voice" && (
            <>
              <h3>Voice & Video</h3>
              <p className="muted">
                Voice goes through this BloodLink server only. Other people never receive your IP address.
                There is no WebRTC and no STUN.
              </p>
              <div className="field">
                <label>Input device</label>
                <select
                  value={micId}
                  onChange={(e) => {
                    setMicId(e.target.value);
                    localStorage.setItem("hearth.mic", e.target.value);
                    setMsg("Microphone saved. Rejoin voice to apply.");
                  }}
                >
                  <option value="">System default</option>
                  {mics.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || "Microphone"}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="btn secondary"
                onClick={async () => {
                  try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    stream.getTracks().forEach((t) => t.stop());
                    const devs = await navigator.mediaDevices.enumerateDevices();
                    setMics(devs.filter((d) => d.kind === "audioinput"));
                    setMsg("Microphone permission granted.");
                  } catch (ex) {
                    setErr(ex.message || "Could not access the microphone.");
                  }
                }}
              >
                Test microphone permission
              </button>
            </>
          )}

          {tab === "advanced" && (
            <>
              <h3>Instance</h3>
              <p className="muted">
                Point this app at any BloodLink server. Leave blank to use the local instance on this machine.
              </p>
              <div className="field">
                <label>Server URL</label>
                <input
                  value={instance}
                  onChange={(e) => setInstance(e.target.value)}
                  placeholder="http://192.168.1.10:3928"
                />
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setServerBase(instance);
                  location.reload();
                }}
              >
                Save and reconnect
              </button>
              <p className="muted" style={{ marginTop: 24 }}>
                Source:{" "}
                <a href={sourceUrl} target="_blank" rel="noreferrer">
                  {sourceUrl}
                </a>
                <br />
                License: GNU Affero GPL v3
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProfilePop({ user, x, y, me, onMessage, onFriend, onKick }) {
  return (
    <div className="popout" style={{ left: Math.min(x, window.innerWidth - 320), top: Math.min(y, window.innerHeight - 280) }}>
      <div className="pop-banner" style={{ background: user.banner_color || user.avatar_color || "#e85d04" }} />
      <div className="pop-body">
        <Avatar user={user} size="lg" />
        <h4>{displayName(user)}</h4>
        <div className="tag">{tagName(user)}</div>
        {user.custom_status && <div className="muted" style={{ marginTop: 6 }}>{user.custom_status}</div>}
        {user.bio && (
          <div className="pop-sec">
            <h5>About me</h5>
            <div>{user.bio}</div>
          </div>
        )}
        <div className="pop-sec">
          <h5>Member since</h5>
          <div>{user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}</div>
        </div>
        {user.id !== me?.id && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn sm" onClick={onMessage}>Message</button>
            <button className="btn secondary sm" onClick={onFriend}>Add friend</button>
            {onKick && (
              <button className="btn danger sm" onClick={onKick}>Kick</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ContextMenu({ x, y, items }) {
  return (
    <div className="menu" style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 40 * items.length) }}>
      {items.map((it, i) =>
        it === "-" ? (
          <hr key={i} />
        ) : (
          <button key={i} className={it.danger ? "danger" : ""} onClick={it.onClick}>
            {it.label}
          </button>
        )
      )}
    </div>
  );
}
