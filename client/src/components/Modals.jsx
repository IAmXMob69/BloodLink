import React, { useState } from "react";
import { api, uploadFile, setServerBase, getServerBase, setToken } from "../lib/api.js";
import { getState, setState } from "../lib/store.js";
import { displayName, tagName } from "../lib/format.jsx";
import Avatar from "./Avatar.jsx";

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
  React.useEffect(() => {
    api(`/api/servers/${server.id}/invites`, { method: "POST", body: {} })
      .then((d) => setCode(d.invite.code))
      .catch(() => {});
  }, [server.id]);
  function copy() {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <ModalShell onClose={() => setState({ modal: null })}>
      <h3>Invite friends to {server.name}</h3>
      <div className="body">
        <p className="muted">Share this code. Anyone with it can join this server.</p>
        <div className="invite-code">{code || "…"}</div>
      </div>
      <div className="foot">
        <button className="btn secondary" onClick={() => setState({ modal: null })}>Done</button>
        <button className="btn" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
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

export function Settings({ me }) {
  const tab = getState().settingsTab;
  const [display, setDisplay] = useState(me.display_name || "");
  const [bio, setBio] = useState(me.bio || "");
  const [custom, setCustom] = useState(me.custom_status || "");
  const [instance, setInstance] = useState(getServerBase());
  const [pwMsg, setPwMsg] = useState("");

  async function saveProfile(e) {
    e.preventDefault();
    await api("/api/me", { method: "PATCH", body: { display_name: display, bio, custom_status: custom } });
    setPwMsg("Saved.");
  }

  async function onAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file, "avatar");
  }

  function setStatus(status) {
    api("/api/me", { method: "PATCH", body: { status } });
  }

  return (
    <ModalShell wide onClose={() => setState({ settingsOpen: false })}>
      <div className="settings">
        <nav>
          <div className="lab">User settings</div>
          {["account", "profile", "appearance", "voice", "advanced"].map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setState({ settingsTab: t })}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
          <div className="lab">Danger</div>
          <button
            className="danger"
            onClick={() => {
              setToken("");
              setState({ settingsOpen: false, me: null, token: "" });
              location.reload();
            }}
          >
            Log out
          </button>
        </nav>
        <div className="pane">
          <button className="icon-btn" style={{ float: "right" }} onClick={() => setState({ settingsOpen: false })}>
            ✕
          </button>
          {tab === "account" && (
            <>
              <h3>My Account</h3>
              <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16 }}>
                <Avatar user={me} size="lg" />
                <div>
                  <div className="strong">{displayName(me)}</div>
                  <div className="muted">{tagName(me)}</div>
                  <label className="btn sm" style={{ display: "inline-block", marginTop: 8 }}>
                    Change avatar
                    <input type="file" accept="image/*" hidden onChange={onAvatar} />
                  </label>
                </div>
              </div>
              <form onSubmit={saveProfile}>
                <div className="field">
                  <label>Display name</label>
                  <input value={display} onChange={(e) => setDisplay(e.target.value)} />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input value={me.email || ""} disabled />
                </div>
                <button className="btn" type="submit">Save changes</button>
                {pwMsg && <span className="muted" style={{ marginLeft: 12 }}>{pwMsg}</span>}
              </form>
            </>
          )}
          {tab === "profile" && (
            <>
              <h3>Profile</h3>
              <div className="field">
                <label>Custom status</label>
                <input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={128} />
              </div>
              <div className="field">
                <label>About me</label>
                <textarea rows={4} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={190} />
              </div>
              <div className="field">
                <label>Status</label>
                <div className="status-row">
                  {["online", "idle", "dnd", "invisible"].map((s) => (
                    <button key={s} className="btn secondary sm" onClick={() => setStatus(s)}>
                      <span className={`dot st-${s}`} style={{ position: "static", border: 0, width: 10, height: 10 }} />
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn" onClick={saveProfile}>Save</button>
            </>
          )}
          {tab === "appearance" && (
            <>
              <h3>Appearance</h3>
              <p className="muted">Hearth ships with a dark theme designed for long conversations. Light theme is welcome as a pull request.</p>
            </>
          )}
          {tab === "voice" && (
            <>
              <h3>Voice & Video</h3>
              <p className="muted">
                Voice uses peer-to-peer WebRTC with a public STUN server. For some NATs you may need a TURN server later.
                Grant microphone permission when you join a voice channel.
              </p>
            </>
          )}
          {tab === "advanced" && (
            <>
              <h3>Instance</h3>
              <p className="muted">Point the desktop app at any Hearth server. Leave blank to use the local/default instance.</p>
              <div className="field">
                <label>Server URL</label>
                <input value={instance} onChange={(e) => setInstance(e.target.value)} placeholder="http://192.168.1.10:3928" />
              </div>
              <button
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
                <a href={getState().sourceUrl} target="_blank" rel="noreferrer">
                  {getState().sourceUrl}
                </a>
                <br />
                License: GNU Affero GPL v3
              </p>
            </>
          )}
        </div>
      </div>
    </ModalShell>
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
